import {createClient as Supabase} from '@supabase/supabase-js'

let config = {
	// Base config for tests
	supabaseUrl: 'FIXME',
	supabaseKey: 'FIXME',
	supabaseOptions: {
		realtime: {
			// transport: window.WebSocket, // FIXME: Fix for https://github.com/supabase/realtime-js/issues/219#issuecomment-1387158074
		},
	},

	// Test utility functions
	setup() {
		// config.supabase = Supabase(config.supabaseUrl, config.supabaseKey, config.supabaseOptions);
	},

	teardown() {
	},

	reactive() {
		return {
			supabase: config.supabase,
			table: config.table,
			idColumn: config.idColumn,
		};
	},
}
export default config;
