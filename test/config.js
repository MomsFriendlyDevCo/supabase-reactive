import {createClient as Supabase} from '@supabase/supabase-js'
import mlog from 'mocha-logger';

/**
* Base config for tests
* @type {Object}
*/
let config = {
	supabaseUrl: 'https://ijnqntoireecgbqmlpka.supabase.co',
	supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqbnFudG9pcmVlY2dicW1scGthIiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTA0NDMyNzksImV4cCI6MjAwNjAxOTI3OX0.xacVcYUsyWw3rYybDDln1oDs9xB4LQqv7xDK-8xuyLU',
	supabaseOptions: {
		realtime: {
			// transport: window.WebSocket, // FIXME: Fix for https://github.com/supabase/realtime-js/issues/219#issuecomment-1387158074
		},
	},

	table: 'test',
	idColumn: 'id',
	dataColumn: 'data',
	timestampColumn: 'edited_at',

	// Base settings passed when we init Reactive()
	baseReactive() { return {
		supabase: config.supabase,
		table: config.table,
		idColumn: config.idColumn,
		debug(...msg) {
			mlog.log(`[SUPABASE/${this.table}/${this.id}]`, ...msg);
		},
	}},
}


/**
* Create `config.supabase` instance + call reset()
*
* @returns {Promise} A promise which resolves when the operation has completed
*/
export async function setup() {
	config.supabase = Supabase(config.supabaseUrl, config.supabaseKey, config.supabaseOptions);
	await reset();
}


/**
* Reset database / table state
*
* @returns {Promise} A promise which resolves when the operation has completed
*/
export async function reset() {
	// Erase all existing data
	await config.supabase
		.from(config.table)
		.delete()
		.neq('id', '00000000-0000-0000-0000-000000000000') // Have to pass in a filter which will never match to keep Supabase happy when calling .delete()

	// Create some dummy data
	await config.supabase
		.from(config.table)
		.insert([
			{
				[config.idColumn]: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
			},
			{
				[config.idColumn]: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
				[config.dataColumn]: {
					existingKey: 'bbb',
				}
			},
			{
				[config.idColumn]: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
				[config.dataColumn]: {
					existingArray: [1, 2, {three: 3}],
				}
			},
		])
		.select('id')
}


/**
* Release all open handles + prepare for shutdown
*/
export function teardown() {
}


export default {
	...config,

	// Test utility functions
	setup, reset, teardown,
}
