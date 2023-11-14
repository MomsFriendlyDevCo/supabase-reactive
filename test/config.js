import {createClient as Supabase} from '@supabase/supabase-js'

/**
* Base config for tests
* @type {Object}
*/
let config = {
	supabaseUrl: 'FIXME',
	supabaseKey: 'FIXME',
	supabaseOptions: {
		realtime: {
			// transport: window.WebSocket, // FIXME: Fix for https://github.com/supabase/realtime-js/issues/219#issuecomment-1387158074
		},
	},


}


/**
* Create `config.supabase` instance + call reset()
* @returns {Promise} A promise which resolves when the operation has completed
*/
export function setup() {
	config.supabase = Supabase(config.supabaseUrl, config.supabaseKey, config.supabaseOptions);
}


/**
* Reset database / table state
*/
export function reset() {
}


/**
* Release all open handles + prepare for shutdown
*/
export function teardown() {
}


export default {
	...config,

	baseReactiveSettings: {
		supabase: config.supabase,
		table: config.table,
		idColumn: config.idColumn,
	},

	// Test utility functions
	setup, reset, teardown,
}
