import {reactive as VueReactive, watch as VueWatch} from 'vue';

export default function SupabaseReactive(path, options) {
	let settings = {
		// Reactive instance
		supabase: null,
		table: null,
		id: null,
		isArray: false,

		// Reactive options
		attachReactives: true,

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
		},

		// Callbacks
		onInit(data) {},
		onRead(data) {},

		// Utilities
		debug: null, // Init in settings setup, false to disable
		splitPath(value) { // Split paths of the form 'TABLE/ID' into their options
			let pathValues = /^\/?(?<table>[\w_\-]+?)\/(?<id>.+)$/.exec(value)?.groups;
			if (!pathValues) throw new Error(`Unable to decode path "${value}"`);
			return pathValues;
		},

		read: true,
		write: true,
		...(typeof path == 'object' ? path : options),
	};

	// Settings init
	if (!settings.supabase) throw new Error('No `supabase` setting given');
	if (typeof path == 'string') Object.assign(settings, settings.splitPath(path));

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
		$id: settings.id,
		$table: settings.table,
		$timestamp: null,


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
			await reactives.$read();
			return reactive;
		},


		/**
		* Fetch the current data state from the server and update the reactive
		*
		* @returns {Promise} A promise which resolves when the operation has completed
		*/
		async $read() {
			if (!settings.read) return; // Reading is disabled anyway

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
