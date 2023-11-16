import config from './config.js';
import {expect} from 'chai';
import mlog from 'mocha-logger';
import {random, sampleSize} from 'lodash-es';
import Reactive, {defaults as ReactiveDefaults} from '#lib/reactive';
import {setTimeout as tick} from 'node:timers/promises';

// Utility: buildRandomBranch() {{{
function buildRandomBranch(depth = 0) {
	let dice = // Roll a dice to pick the content
		depth == 0 ? 10 // first roll is always '10'
		: random(0, 11 - depth, false); // Subsequent rolls bias downwards based on depth (to avoid recursion)

	return (
		dice == 0 ? false
		: dice == 1 ? true
		: dice == 2 ? random(1, 10000)
		: dice == 3 ? (new Date(random(1000000000000, 1777777777777))).toISOString()
		: dice == 5 ? Array.from(new Array(random(1, 10)), ()=> random(1, 10))
		: dice == 6 ? null
		: dice < 8 ? Array.from(new Array(random(1, 10)), ()=> buildRandomBranch(depth+1))
		: Object.fromEntries(
			Array.from(new Array(random(1, 5)))
				.map((v, k) => [
					`key_${k}`,
					buildRandomBranch(depth+1),
				])
		)
	)
}

// }}}

describe('@MomsFriendlyDevCo/Supabase-Reactive', ()=> {

	before('supabase setup', config.setup)
	after('supabase teardown', config.teardown)

	it('basic state checking (purely offline)', async ()=> {
		let state = await Reactive({
			...config.baseReactive(),

			// Purely offline state options
			read: false,
			watch: false,
			write: false,
		});

		// Simple key = val
		state.foo = 'Foo!';

		// Merge via Object.assign
		Object.assign(state, {bar: 'Bar!'});

		expect(state).to.deep.equal({
			foo: 'Foo!',
			bar: 'Bar!',
		});
	});

	it('access an existing row (via settings)', async ()=> {
		let fetchedA = await Reactive({
			...config.baseReactive(),
			id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
			watch: false,
			write: false,
		});
		expect(fetchedA).to.be.an('object');
		expect(fetchedA).to.have.nested.property('$meta.id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
		expect(fetchedA).to.have.nested.property('$meta.timestamp');
		expect(fetchedA).to.deep.equal({});
	});

	it('access existing rows (via path + options)', async ()=> {
		let fetchedB = await Reactive(`${config.table}/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb`, {
			...config.baseReactive(),
			watch: false,
			write: false,
		})
		expect(fetchedB).to.be.an('object');
		expect(fetchedB).to.have.nested.property('$meta.id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
		expect(fetchedB).to.have.nested.property('$meta.timestamp');
		expect(fetchedB).to.be.deep.equal({
			existingKey: 'bbb',
		});
	});

	it('access existing rows (via path + defaults)', async ()=> {
		Object.assign(ReactiveDefaults, config.baseReactive());

		let fetchedC = await Reactive(`${config.table}/cccccccc-cccc-cccc-cccc-cccccccccccc`);
		expect(fetchedC).to.be.an('object');
		expect(fetchedC).to.have.nested.property('$meta.id', 'cccccccc-cccc-cccc-cccc-cccccccccccc');
		expect(fetchedC).to.have.nested.property('$meta.timestamp');
		expect(fetchedC).to.be.deep.equal({
			existingArray: [1, 2, {three: 3}],
		});
	});

	it('react to lifecycle', async ()=> {
		let tripped = {
			init: 0,
			read: 0,
			change: 0,
			destroy: 0,
		};

		let state = await Reactive(`${config.table}/dddddddd-dddd-dddd-dddd-dddddddddddd`, {
			...config.baseReactive(),
			onInit: ()=> tripped.init++,
			onRead: ()=> tripped.read++,
			onChange: ()=> tripped.change++,
			onDestroy: ()=> tripped.destroy++,
		});

		// Check that init has registered
		expect(state.$meta.version).to.equal(0);
		expect(tripped).to.be.deep.equal({
			init: 1,
			read: 0,
			change: 0,
			destroy: 0,
		});

		// Write local key
		state.foo = 'Foo!';
		expect(state).to.deep.equal({foo: 'Foo!'});

		// Flush to server + check stats
		await state.$flush();
		// expect(state.$meta.version).to.equal(1);
		expect(tripped).to.be.deep.equal({
			init: 1,
			read: 0,
			change: 1,
			destroy: 0,
		});

		// Read back + check stats
		await state.$read();
		// expect(state.$meta.version).to.equal(1);
		expect(tripped).to.be.deep.equal({
			init: 1,
			read: 1,
			change: 2,
			destroy: 0,
		})

		// Trigger destroy + check state
		await state.$destroy();
		expect(tripped).to.be.deep.equal({
			init: 1,
			read: 1,
			change: 2,
			destroy: 1,
		})
	});

	it('sync various data types', async ()=> {
		let struct = {
			keyDateString: (new Date()).toISOString(), // NOTE: JSONB cannot store Data types natively
			keyNumber: 123,
			keyBoolean: true,
			keyArray: [1, 2, false],
			keyNull: null,
		};

		let state = await Reactive(`${config.table}/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee`, {
			...config.baseReactive(),
		});
		Object.assign(state, struct);

		// Wait for local observers to catch up
		await tick();

		// Check local state has updated against the proposed one
		expect(state).to.be.deep.equal(struct);

		// Await server flush
		await state.$flush();

		// Fetch serer snapshot and compare against local
		let serverSnapshot = await state.$fetch();
		expect(serverSnapshot).to.deep.equal(state);
	});

	it.skip('dueling updates', async function() {
		this.timeout(30 * 1000); //~ 30s timeout

		let a = await Reactive(`${config.table}/ffffffff-ffff-ffff-ffff-ffffffffffff`, {...config.baseReactive()});
		let b = await Reactive(`${config.table}/ffffffff-ffff-ffff-ffff-ffffffffffff`, {...config.baseReactive()});

		for (let i = 1; i < 3; i++) {
			mlog.log('Iteration', i);

			// Assign changes to A
			Object.assign(a, {
				...a,
				...buildRandomBranch(),
			});

			// Wait for local observers to catch up
			await tick(2000);

			// Check A and B match
			console.log('B VALUE', b);
			expect(a).to.deep.equal(b);
		}
	});

	it('deeply nested state read/write change detection + sync', async function () {
		this.timeout(30 * 1000); //~ 30s timeout

		let state = await Reactive(`${config.table}/11111111-1111-1111-1111-111111111111`, {
			...config.baseReactive(),
		});

		for (let i = 1; i < 5; i++) {
			mlog.log('Iteration', i);

			// Propose new structure
			let struct = {
				...state,
				...buildRandomBranch(),
			};

			// Assign proposed structure to state - expect watcher to pick this up
			Object.assign(state, struct);

			// Check local state has updated against the proposed one
			expect(state).to.be.deep.equal(struct);

			// Wait for local observers to catch up
			await tick();

			// Await server flush
			await state.$flush();

			// Force-fetch server version and compare to local
			let serverSnapshot = await state.$fetch();
			/*
			console.log('3Way compare', {
				state: Object.keys(state).sort(),
				struct: Object.keys(struct).sort(),
				serverSnapshot: Object.keys(serverSnapshot).sort(),
			});
			*/
			expect(state).to.deep.equal(serverSnapshot);

			// Randomly nuke keys
			sampleSize(Object.keys(state), random(0, 2))
				.forEach(key => {
					delete state[key];
					delete struct[key];
				});
		}
	});

});
