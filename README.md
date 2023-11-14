@MomsFriendlyDevCo/Supabase-Reactive
====================================
Supabase plugin for reactive read/write against local objects.

Extends the existing [Supabase](https://supabase.com) JavaScript functionality by adding a bi-directional, bound object which syncs with the server when its state changes. Changes on the server (or from another client) similarly update local state across all clients.

```javascript
import Reactive from '@momsfriendlydevco/supabase-reactive';
import {createClient} from '@supabase/supabase-js'

// Create a Supabase client
let supabase = creatClient('https://MY-SUPABASE-DOMAIN.supabase.co', 'big-long-key');

// Create a reactive
let state = Reactive('my-table/id-to-sync', {supabase});

// Changes to state are now synced bi-directionally
state.foo = 1;
state.bar = [1, 2, 3];
state.baz = {key1: {subkey1: [4, 5, 6]}};
delete state.bar;
```
