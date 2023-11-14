import config from './config.js';
import {expect} from 'chai';
import Reactive from '#lib/reactive';

describe('@MomsFriendlyDevCo/Supabase-Reactive', ()=> {

	before('supabase setup', config.setup)
	after('supabase teardown', config.teardown)

	it('basic state checking (purely offline)', async ()=> {
		let state = await Reactive({
			...config.baseReactive(),

			// Purely offline state options
			read: false,
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
		});
		expect(fetchedA).to.be.an('object');
		expect(fetchedA).to.have.property('$id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
		expect(fetchedA).to.have.property('$timestamp');
		expect(fetchedA).to.deep.equal({});
	});

	it('access existing rows (via path)', async ()=> {
		let fetchedB = await Reactive(`${config.table}/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb`, config.baseReactive())
		expect(fetchedB).to.be.an('object');
		expect(fetchedB).to.have.property('$id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
		expect(fetchedB).to.have.property('$timestamp');
		expect(fetchedB).to.be.deep.equal({
			existingKey: 'bbb',
		});

		let fetchedC = await Reactive(`${config.table}/cccccccc-cccc-cccc-cccc-cccccccccccc`, config.baseReactive())
		expect(fetchedC).to.be.an('object');
		expect(fetchedC).to.have.property('$id', 'cccccccc-cccc-cccc-cccc-cccccccccccc');
		expect(fetchedB).to.have.property('$timestamp');
		expect(fetchedC).to.be.deep.equal({
			existingArray: [1, 2, {three: 3}],
		});
	})

});
