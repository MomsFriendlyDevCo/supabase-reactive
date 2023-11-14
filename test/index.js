import config from './config.js';
import {expect} from 'chai';
import Reactive, {defaults as ReactiveDefaults} from '#lib/reactive';

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
		expect(fetchedA).to.have.property('$id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
		expect(fetchedA).to.have.property('$timestamp');
		expect(fetchedA).to.deep.equal({});
	});

	it('access existing rows (via path + options)', async ()=> {
		let fetchedB = await Reactive(`${config.table}/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb`, {
			...config.baseReactive(),
			watch: false,
			write: false,
		})
		expect(fetchedB).to.be.an('object');
		expect(fetchedB).to.have.property('$id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
		expect(fetchedB).to.have.property('$timestamp');
		expect(fetchedB).to.be.deep.equal({
			existingKey: 'bbb',
		});
	});

	it('access existing rows (via path + defaults)', async ()=> {
		Object.assign(ReactiveDefaults, config.baseReactive());

		let fetchedC = await Reactive(`${config.table}/cccccccc-cccc-cccc-cccc-cccccccccccc`);
		expect(fetchedC).to.be.an('object');
		expect(fetchedC).to.have.property('$id', 'cccccccc-cccc-cccc-cccc-cccccccccccc');
		expect(fetchedC).to.have.property('$timestamp');
		expect(fetchedC).to.be.deep.equal({
			existingArray: [1, 2, {three: 3}],
		});
	});

	it('react to read/write cycle', async ()=> {
		Object.assign(ReactiveDefaults, config.baseReactive());

		let tripped = {
			init: 0,
			read: 0,
			localChange: 0,
		};

		let state = await Reactive(`${config.table}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`, {
			onInit: ()=> tripped.init++,
			onRead: ()=> tripped.read++,
			onLocalChange: ()=> tripped.localChange++,
		});
		state.foo = 'Foo!';

		expect(tripped).to.be.deep.equal({
			init: 1,
			read: 0,
			localChange: 0,
		})
		expect(state).to.deep.equal({foo: 'Foo!'});

		// Flush to server + check stats
		await state.$flush();
		expect(tripped).to.be.deep.equal({
			init: 1,
			read: 0,
			localChange: 1,
		})

		// Read back + check stats
		await state.$read();
		expect(tripped).to.be.deep.equal({
			init: 1,
			read: 1,
			localChange: 1,
		})
	});

});
