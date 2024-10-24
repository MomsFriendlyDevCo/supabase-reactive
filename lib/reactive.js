import {cloneDeepWith, debounce, isPlainObject} from 'lodash-es';
import {nextTick, reactive as VueReactive, watch as VueWatch} from 'vue';

/**
* Return a reactive object (or array) which syncs local and remote state
*
* @param {String} [path] Optional, shorthand path to subscribe to. By default this is of the form `$TABLE/$ID`
*
* @param {Object} [options] Additional options to configure behaviour, uses this modules defaults first if unspecified
*
* @param {Supabase} options.supbase Supabase instance to use
* @param {String} [options.table] Supabase table to store data within if `path` is not specified
* @param {String} [options.id] ID of the table row to sync data with
* @param {Boolean} [options.isArray=false] Specifies if the data entity is an Array rather than an object
*
* @param {Boolean} [options.read=true] Allow reading from the remote Supabase server, disabling this makes the data transfer transmit only
* @param {Boolean} [options.watch=true] Allow watching for local changes and write them to the remote server if enabled
* @param {Boolean} [options.write=true] Allow writing back local changes to the Supabase server
* @param {Boolean} [options.attachReactives=true] Expose all utility functions as '$' prefixed functions to control the local state
* @param {Object} [options.throttle] Lodash debounce options + `wait` key used to throttle all writes, set to falsy to disable
*
* @param {String} [options.idColumn='id'] Row ID column to sync with
* @param {Object} [options.filter] Query filter to use when accessing multiple rows
* @param {String} [options.dataColumn='data'] Data / JSONB column to sync data with
* @param {String} [options.timestampColumn='edited_at'] Timezone+TZ column to use when syncing data
* @param {String} [options.versionColumn] Optional version column, this increments on each write and is only really useful for debugging purposes
*
* @param {Function} [options.reactiveCreate] Async function used to create an observable / reactive data entity from its input. Defaults to Vue's reactive function
* @param {Function} [options.reactiveWatch] Async function used to create a watch on the created reactive. Defaults to Vue's watch function
*
* @param {Function} [options.onInit] Async function when first populating data from the remote. Called as `(data:Object|Array)`
* @param {Function} [options.onRead] Async function called on subsequent reads when populating data from the remote. Called as `(data:Object|Array)`
* @param {Function} [options.onChange] Async function called when a detected local write is about to be sent to the remote. Called as `(dataPayload:Object|Array)`
* @param {Function} [options.onDestroy] Async function called when destroying state. Called as `(data:Reactive)`
*
* @param {Function|Boolean} [options.debug] Optional debugging function callback. Called as `(...msg:Any)`
* @param {Function} [options.splitPath] Path parser, expected to decorate the `settings` object. Called as `(path: String, settings: Object)` and expected to mutate the settings state
*
* @returns {Promise<Reactive>} An eventual reactive Object/Array with utility functions (if `{attachReactives:true}`)
*/
export default function SupabaseReactive(path, options) {
	let settings = {
		...defaults,
		...(typeof path == 'object' ? path : options),
	};

	// Settings init
	if (!settings.supabase) throw new Error('No `supabase` setting given');
	if (typeof path == 'string') settings.splitPath(path, settings);

	settings.debug = settings.debug && typeof settings.debug == 'function' ? settings.debug.bind(settings) // Given a debug function
		: settings.debug === false ? ()=> {}
		: console.log.bind(settings, `[SUPABASE/${settings.table}/${settings.id}]`);

	let reactive = settings.reactiveCreate(!settings.isArray ? {} : []);

	/**
	* Base reactive functionality mapped onto the output as non-enumerable functions
	* These are Functions appended to the binding which can be called to perform various utility actions
	* @type {Object}
	*/
	let reactives = {
		/**
		* Meta information about the current row
		* (This only really exists because we can't assign scalars in Javascript without it resetting the pointer later)
		*
		* @type {Object}
		* @property {String} id The ID of the current row
		* @property {String} table The active table for the current row
		* @property {Null|Date} timestamp The last known timestamp of data from the server (or NULL if no data has been pulled yet)
		* @property {Null|Number} If a versioning column is enabled this represents the last known version of the data, similar to $meta.timestamp
		* @property {Boolean} Whether the state is being updated locally - indicates that local watchers should ignore incoming change detection
		* @property {Function} [watcher] Optional watch() binding to release a local watcher
		*/
		$meta: settings.reactiveCreate({
			id: settings.id,
			table: settings.table,
			timestamp: null,
			version: null,
			isUpdating: false,
			watcher: null,
		}),


		/**
		* Wait for Vue to update + a set amount of time to expire
		* This is used within $set() to correctly release the write lock
		*
		* @param {Number} delay Time in milliseconds to wait alongside Vue.$nextTick
		* @returns {Promise} A promise which will resolve when both Vue has moved on a tick + a set timeout has occured
		*/
		async $waitTick(delay) {
			await nextTick();

			await new Promise(resolve =>
				setTimeout(()=> resolve(), delay)
			);
		},


		/**
		* Set the content of the reactive
		*
		* @param {Object|Array} data New state to adopt
		*
		* @param {Object} [options] Additional options to mutate behaviour
		* @param {Boolean} [options.markUpdating=true] Mark the object as within an update to prevent recursion + disable local observers
		* @param {Number} [options.updateDelay=100] Additional time in milliseconds to wait (as well as Vue.$nextTick) before releasing the write lock to prevent change collisions
		* @param {Boolean} [options.removeKeys=true] Clean out dead reactive keys if the new state doesn't also contain them
		* @param {Date} [options.timestamp] Set the reactive timestamp if provided
		* @param {Number} [options.version] Set the reactive version if provided
		*
		* @returns {Promise} A promise which resolves when the operation has completed
		*/
		async $set(data, options) {
			options = {
				markUpdating: true,
				updateDelay: 1000,
				removeKeys: true,
				timestamp: null,
				version: null,
				...options,
			};

			if (options.markUpdating) {
				if (reactives.$meta.isUpdating) throw new Error('Reactive.$set() already in process! Recursion prevented');
				reactives.$meta.isUpdating = true;
			}

			Object.assign(reactive, data);

			if (options.removeKeys) {
				Object.keys(reactive).forEach(key => {
					if (!(key in data)) {
						settings.debug('Remove redundent key', key);
						delete reactive[key];
					}
				})
			}

			if (options.timestamp) reactives.$meta.timestamp = options.timestamp;
			if (options.version) reactives.$meta.version = options.version;

			// Schedule releasing the update lock - this has to be after the next update cycle so we don't get trapped in a $watch->change loop
			if (options.markUpdating) {
				await reactives.$waitTick(options.updateDelay);

				settings.debug('Release write lock');
				reactives.$meta.isUpdating = false;
			}
		},


		/**
		* Tidy JSON field data so that is safe from private methods (anything starting with '$' or '_', proxies or other non POJO slush
		* @param {Object|Array} input Input object to tidy
		* @returns {Object|Array} POJO, scalar output
		*/
		$toObject() {
			return cloneDeepWith(reactive, (v, k) => // Clone so we break up all the proxy slush and store primatives only
				!/^[$\_]/.test(k) // Key doesn't start with '$' or '_'
				&& (
					['string', 'number', 'boolean'].includes(typeof v) // Basic scalar types
					|| Array.isArray(v)
					|| isPlainObject(v)
				)
					? undefined // Use default cloning behaviour
					: null // Strip from output
			);
		},


		/**
		* Alias of `$read()`
		* @alias $read
		*/
		$refresh(options) {
			return reactives.read(options);
		},


		/**
		* Generate a Supabase object representing a query for the current configuration
		*
		* @returns {Promise} A Supabase promise which resolves when the operation has completed
		*/
		$getQuery() {
			let query = settings.supabase
				.from(settings.table)
				.select([
					settings.idColumn,
					settings.timestampColumn,
					settings.dataColumn,
					settings.versionColumn && settings.versionColumn,
				].filter(Boolean).join(','))

			if (settings.isArray || settings.filter) {
				query.filter(...settings.filter);
			} else {
				query.eq(settings.idColumn, settings.id);
			}

			if (!settings.isArray)
				query.single().limit(1);

			return query;
		},


		/**
		* Initial operaton to wait on data from service + return reactable
		* This function is the default response when calling the outer `Reactive()` function
		*
		* @returns {Promise<Reactive<Object>>} A promise which resolves with the initial data state when loaded
		*/
		async $init() {
			if (reactives.$meta.timestamp) throw new Error('Reactive.$init() has already been called');

			// Read initial state (if settings.read)
			if (settings.read) await reactives.$read();

			// Subscribe to local watcher (if settings.watch)
			if (settings.watch) await reactives.$watch();

			// Subscribe to remote (if settings.write)
			if (settings.write) await reactives.$subscribe();

			return reactive;
		},


		/**
		* Fetch the current data state from the server and update the reactive
		*
		* @param {Object} [options] Additional options to mutate behaviour
		* @param {Boolean} [options.force=false] Forcibly read in server values, overriding local values
		*
		* @returns {Promise} A promise which resolves when the operation has completed
		*/
		async $read(options) {
			let readSettings = {
				force: false,
				...options,
			};

			let {data} = await reactives.$getQuery();

			// Mangle incoming row into a dataVal
			let dataVal = settings.isArray
				? data.map(row => ({
					id: row.id,
					...row[settings.dataColumn],
				}))
				: data?.[settings.dataColumn] || {};

			// Mangle incoming row into a dataTimestamp
			let dataTimestamp = settings.isArray
				? data.reduce((latest, row) => // Extract the most up to date stamp
					latest === null || latest < row[settings.timestampColumn]
						? row[settings.timestampColumn]
						: latest
				, null)
				: data?.[settings.timestampColumn];

			// Mangle incoming row into a dataVersion
			let dataVersion =
				!settings.versionColumn ? null
				: settings.isArray ? data.reduce((largest, row) => // Extract the most up to date stamp
					largest === null || largest < row[settings.versionColumn]
						? row[settings.versionColumn]
						: largest
				, null)
				: data?.[settings.versionColumn];

			// Trigger callbacks if its an init or simple read operation
			if (reactives.$meta.version === null) {
				settings.debug('INIT VALUE', dataVal);
				reactives.$meta.version = 0;
				await settings.onInit(dataVal);
			} else {
				settings.debug('READ VALUE', dataVal);
				await settings.onRead(dataVal);
			}

			// Assign the data
			await reactives.$set(dataVal, {
				timestamp: dataTimestamp,
				version: dataVersion,
				removeKeys: !readSettings.force,
			});
		},


		/**
		* Fetch the current data state from the server but don't update the local state
		* This function is only really useful for snapshotting server state
		*
		* @returns {Promise} A promise which resolves when the operation has completed
		*/
		async $fetch() {
			let {data} = await reactives.$getQuery();

			return settings.isArray
				? data.map(row => ({
					id: row.id,
					...row[settings.dataColumn],
				}))
				: data?.[settings.dataColumn] || {};
		},


		/**
		* Watch local data for changes and push to the server as needed
		*
		* @param {Boolean} [isWatching=true] Status of the local watcher
		* @returns {Promise} A promise which resolves when the operation has completed
		*/
		async $watch(isWatching = true) {
			if (isWatching == !!reactives.$meta.watcher) return; // Already in the state requested

			if (isWatching) { // Subscribe
				settings.debug('Subscribed to local changes');
				reactives.$meta.watcher = settings.reactiveWatch(
					reactive,
					settings.throttle
						? debounce(reactives.$touchLocal, settings.throttle.wait, settings.throttle)
						: reactives.$touchLocal
				);
			} else { // Unsubscribe
				settings.debug('UN-subscribed from local changes');
				reactives.$meta.watcher();
				reactives.$meta.watcher = null;
			}
		},


		/**
		* Internal function called when detecting a local change
		*
		* @access private
		* @returns {Promise} A promise which resolves when the operation has completed
		*/
		async $touchLocal() {
			if (reactives.$meta.isUpdating) return; // Elsewhere is updating - ignore all local callbacks

			let payload = reactives.$toObject();
			let payloadTimestamp = new Date();
			let payloadVersion = settings.versionColumn ? (reactives.$meta.version ?? 0) + 1 : 0;

			if (settings.isArray) throw new Error('TODO: Local array syncing is not yet supported');

			await settings.onChange(payload);

			// Store local timestamp so we don't get into a loop when the server tells us about the change we're about to make
			reactives.$meta.timestamp = payloadTimestamp;

			// Increment local version
			if (settings.versionColumn)
				reactives.$meta.version++;

			settings.debug('LOCAL CHANGE', {
				$meta: reactives.$meta,
				payload,
			});

			// Assign a pending promise so calls to flush() can wait on this
			reactives.$touchLocal.promise = settings.supabase
				.from(settings.table)
				.upsert({
					[settings.idColumn]: reactives.$meta.id,
					[settings.dataColumn]: payload,
					[settings.timestampColumn]: payloadTimestamp,
					...(settings.versionColumn && {
						[settings.versionColumn]: payloadVersion,
					}),
				}, {
					onConflict: settings.idColumn,
					ignoreDuplicates: false,
				})
				.eq(settings.idColumn, reactives.$meta.id)
				.select('id')
				.then(()=> settings.debug('LOCAL CHANGE flushed', {
					newTimestamp: payloadTimestamp,
					newVersion: payloadVersion,
				}))
				.then(()=> true); // FIX: Need to end on a promisable here otherwise Supabase can sometimes get confused and not execute the query

			await reactives.$touchLocal.promise;
		},


		/**
		* Internal function called when detecting a remote change
		*
		* @access private
		* @returns {Promise} A promise which resolves when the operation has completed
		*/
		async $touchRemote(data) {
			if (!data.new) return; // No payload to prcess anyway

			// Tidy up incoming data fields
			let dataVersion = data.new[settings.versionColumn];
			let dataTimestamp = new Date(data.new[settings.timestampColumn]);

			settings.debug(
				'REMOTE CHANGE',
				settings.versionColumn
					? `Server@${dataVersion}, Local@${reactives.$meta.version}`
					: `Server@${dataTimestamp ? dataTimestamp.toISOString() : 'NOW'}, Local@${reactives.$meta.timestamp ? reactives.$meta.timestamp : '[NONE]'}`,
				data.new[settings.dataColumn],
			);

			if (settings.versionColumn && dataVersion <= reactives.$meta.version) return settings.debug('Reject server update - local version is recent enough', {
				localVersion: reactives.$meta.version,
				serverVersion: dataVersion,
			});
			if (reactives.$meta.timestamp && dataTimestamp <= reactives.$meta.timestamp) return settings.debug('Reject server update - local timestamp is recent enough', {
				localTimestamp: reactives.$meta.timestamp,
				serverTimestamp: dataTimestamp,
			});

			await reactives.$set(data.new[settings.dataColumn], {
				removeKeys: true,
				timestamp: dataTimestamp,
				...(settings.versionColumn && {
					version: dataVersion,
				}),
			});

			await settings.onRead(data.new[settings.dataColumn]);
		},


		/**
		* Universal wrapper around setTimeout() which returns a promise
		* NOTE: We can't use node:timers/promises as this may be a front-end install
		*
		* @param {Number} [delay=0] The number of milliseconds to wait
		* @returns {Promise} A promise which resolves when the timeout has completed
		*/
		async $tick(delay = 0) {
			return new Promise(resolve => setTimeout(()=> resolve(), delay));
		},


		/**
		* Wait for all local writes to complete
		* NOTE: This only promises that local writes complete, not that a subsequent read is required
		*
		* @param {Number} [delay=0] The number of milliseconds to wait for write operations to clear
		* @returns {Promise} A promise which resolves when the operation has completed
		*/
		async $flush(delay = 100) {
			return Promise.all([
				reactives.$touchLocal.promise,
				this.$tick(delay),
			]);
		},


		/**
		* Toggle subscription to the realtime datafeed
		*
		* @returns {Promise} A promise which resolves when the operation has completed
		*/
		async $subscribe(isSubscribed = true) {
			if (isSubscribed == reactives.$subscribe.isSubscribed) return; // Already in the state requested

			if (isSubscribed) { // Subscribe to remote
				settings.debug('Subscribed to remote changes');
				let subscribeQuery = {
					event: 'UPDATE',
					schema: 'public',
					table: settings.table,
					filter: settings.isArray || settings.filter
						? settings.filter.join('')
						: `${settings.idColumn}=eq.${settings.id}`,
				};

				return settings.supabase.channel('any')
					.on('postgres_changes', subscribeQuery, reactives.$touchRemote)
					.subscribe();

			} else { // Unsubscribe from remote
				settings.debug('UNsubscribed from remote changes');
				settings.debug('TODO: Unsub from remote watchers is not yet supported');
			}
		},


		/**
		* Release all watchers and subscriptions, local and remote
		*
		* @returns {Promise} A promise which resolves when the operation has completed
		*/
		async $destroy() {
			await settings.onDestroy(reactive);

			await Promise.all([
				reactives.$watch(false),
				reactives.$subscribe(false),
			]);
		},
	};

	if (settings.attachReactives && !settings.isArray) {
		Object.defineProperties(
			reactive,
			Object.fromEntries(
				Object.entries(reactives).map(([key, value]) => [
					key,
					{
						value,
						enumerable: false,
						configurable: false,
						writable: typeof value != 'function',
					}
				])
			),
		);
	}

	return reactives.$init();
}


export let defaults = {
	// Reactive instance
	supabase: null,
	table: null,
	id: null,
	isArray: false,

	// Reactive options
	read: true,
	watch: true,
	write: true,
	attachReactives: true,
	throttle: {
		wait: 200,
		maxWait: 2000,
		leading: false,
		trailing: true,
	},

	// Table structure
	idColumn: 'id',
	filter: null,
	dataColumn: 'data',
	timestampColumn: 'edited_at',
	versionColumn: null,

	// Reactive control
	reactiveCreate(state) {
		return VueReactive(state);
	},
	reactiveWatch(target, cb) {
		return VueWatch(target, cb, {
			deep: true,
		});
	},

	// Callbacks
	onInit(data) {}, // eslint-disable-line
	onRead(data) {}, // eslint-disable-line
	onChange(data) {}, // eslint-disable-line
	onDestroy(data) {}, // eslint-disable-line

	// Utilities
	debug: null, // Init in settings setup, false to disable
	splitPath(value, settings) { // Split paths of the form 'TABLE/ID' into their options
		let pathValues = /^\/?(?<table>[\w_\-]+?)\/(?<id>.+)$/.exec(value)?.groups;
		if (!pathValues) throw new Error(`Unable to decode path "${value}"`);
		Object.assign(settings, pathValues);
	},
};
