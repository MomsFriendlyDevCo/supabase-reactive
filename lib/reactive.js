import {cloneDeepWith, debounce, isPlainObject} from 'lodash-es';
import {reactive as VueReactive, watch as VueWatch} from 'vue';

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

	settings.debug = settings.debug ? settings.debug.bind(settings)
		: settings.debug === false ? ()=> {}
		: console.log.bind(settings, `[SUPABASE/${settings.table}/${settings.id}]`);

	let reactive = settings.reactiveCreate(!settings.isArray ? {} : []);

	/**
	* Base reactive functionality mapped onto the output as non-enumerable functions
	* These are Functions appended to the binding which can be called to perform various utility actions
	* @type {Object<Function>}
	* @property {String} $id The unique ID of the document, as specified by the path or `settings.id`
	* @property {String} $table The table name of the document, as specified by the path or `settings.table`
	* @property {Date} $timestamp The last timestamp fetched from the server or we updated, if Null a $read operation is assumed to be the initial version
	* @property {Function} $getQuery Function which generates a Supabase query to fetch the target row(s)
	* @property {Function} $read Async function to read state from the remote Supabase record
	* @property {Function} $refresh Alias for `$read`
	*/
	let reactives = {
		/**
		* The ID of the current row
		* @type {String}
		*/
		$id: settings.id,


		/**
		* The active table for the current row
		* @type {String}
		*/
		$table: settings.table,


		/**
		* The last known timestamp of data from the server (or NULL if no data has been pulled yet)
		* @type {Null|Date}
		*/
		$timestamp: null,


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
		$refresh() {
			return reactives.read();
		},


		/**
		* Generate a Supabase object representing a query for the current configuration
		*
		* @returns {Promise} A Supabase promise which resolves when the operation has completed
		*/
		$getQuery() {
			let query = settings.supabase
				.from(settings.table)
				.select(`${settings.idColumn},${settings.timestampColumn},${settings.dataColumn}`);

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
			if (reactives.$timestamp) throw new Error('Reactive.$init() has already been called');

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
		* @returns {Promise} A promise which resolves when the operation has completed
		*/
		async $read() {
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

			// Trigger callbacks if its an init or simple read operation
			if (!reactives.$timestamp) {
				settings.debug('INIT VALUE', dataVal);
				await settings.onInit(dataVal);
			} else {
				settings.debug('READ VALUE', dataVal);
				await settings.onRead(dataVal);
			}

			// Assign the data
			reactives.$timestamp = dataTimestamp;
			Object.assign(reactive, dataVal);
		},


		/**
		* Watch local data for changes and push to the server as needed
		*
		* @param {Boolean} [isWatching=true] Status of the local watcher
		* @returns {Promise} A promise which resolves when the operation has completed
		*/
		async $watch(isWatching = true) {
			if (isWatching == reactives.$watch.isWatching) return; // Already in the state requested

			if (isWatching) { // Subscribe
				settings.debug('Subscribed to local changes');
				reactives.$watch.isSubscribed = true;
				reactives.$watch.$watcher = settings.reactiveWatch(
					reactive,
					settings.throttle
						? debounce(reactives.$touchLocal, settings.throttle.wait, settings.throttle)
						: reactives.$touchLocal
				);
			} else { // Unsubscribe
				settings.debug('UNsubscribed from local changes');
				reactives.$watch.$watcher();
				reactives.$watch.isSubscribed = false;
			}
		},


		/**
		* Internal function called when detecting a local change
		*
		* @access private
		* @returns {Promise} A promise which resolves when the operation has completed
		*/
		async $touchLocal() {
			let payload = reactives.$toObject();
			let payloadTimestamp = new Date();
			settings.debug('LOCAL CHANGE', payload);

			if (settings.isArray) throw new Error('TODO: Local array syncing is not yet supported');

			await settings.onChange(payload);

			// Store local timestamp so we don't get into a loop when the server tells us about the change we're about to make
			reactives.$timestamp = payloadTimestamp;

			reactives.$touchLocal.promise = await settings.supabase
				.from(settings.table)
				.upsert({
					[settings.idColumn]: reactives.$id,
					[settings.dataColumn]: payload,
					[settings.timestampColumn]: payloadTimestamp,
				}, {
					onConflict: settings.idColumn,
					ignoreDuplicates: false,
				})
				.eq(settings.idColumn, reactives.$id)
				.select('id')
		},


		/**
		* Wait for all local writes to complete
		* NOTE: This only promises that local writes complete, not that a subsequent read is required
		*
		* @returns {Promise} A promise which resolves when the operation has completed
		*/
		async $flush() {
			return reactives.$touchLocal.promise;
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
						configurable: false,
						enumerable: false,
						writable: false,
					}
				])
			)
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
	throttle: { // or False to disable
		wait: 200,
		maxWait: 2000,
		leading: false,
		trailing: true,
	},

	// Table structure
	idColumn: 'id',
	filter: null, // Object filter
	dataColumn: 'data',
	timestampColumn: 'edited_at',

	// Reactive control
	reactiveCreate(state) {
		return VueReactive(state);
	},
	reactiveWatch(target, cb) {
		return VueWatch(target, cb, {deep: true});
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
