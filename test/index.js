import config from './config.js';
import {expect} from 'chai';
import Reactive from '#lib/reactive';

describe('@MomsFriendlyDevCo/Supabase-Reactive', ()=> {

	before('supabase setup', config.setup)
	after('supabase teardown', config.teardown)

	it('basic state checking (purely offline)', ()=> {
		let state = Reactive({
			...config.reactive(),

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

});
