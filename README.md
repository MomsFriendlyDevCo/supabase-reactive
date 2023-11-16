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


API
===

Supabase Table Structure
------------------------
Ideally the data structure within Supabase should be made up of these columns:

* `id` - a UUID is recommended
* `created_at` - optional timestamp to indicate when the row was created
* `edited_at` - timestamp to track changes
* `version` - optional numeric to indicate the version offset of the row
* `data` - the main JSONB data entity storage

An example Postgres data command is:

```sql
create table
  public.test (
    id uuid not null default gen_random_uuid (),
    created_at timestamp with time zone not null default now(),
    edited_at timestamp with time zone null,
    data jsonb null,
    version bigint null,
    constraint test_pkey primary key (id),
    constraint test_id_key unique (id)
  ) tablespace pg_default;
```


SupabaseReactive(path, options)
------------------------------
The main exported function which returns a Reactive object.

The resulting reactive object also has a series of non-enumerable utility functions which all start with a single dollar sign. See below for their purpose and documentation.

This can take an optional shorthand path and/or an options structure.

Valid options are:

| Option                        | Type                   | Default       | Description                                                                                                                                     |
|-------------------------------|------------------------|---------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| `supbase`                     | `Supabase`             |               | Supabase instance to use                                                                                                                        |
| `table`                       | `String`               |               | Supabase table to store data within if `path` is not specified                                                                                  |
| `id`                          | `String`               |               | ID of the table row to sync data with                                                                                                           |
| `isArray=false`               | `Boolean`              | `false`       | Specifies if the data entity is an Array rather than an object                                                                                  |
| `read=true`                   | `Boolean`              | `true`        | Allow reading from the remote Supabase server, disabling this makes the data transfer transmit only                                             |
| `watch=true`                  | `Boolean`              | `true`        | Allow watching for local changes and write them to the remote server if enabled                                                                 |
| `write=true`                  | `Boolean`              | `true`        | Allow writing back local changes to the Supabase server                                                                                         |
| `attachReactives=true`        | `Boolean`              | `true`        | Expose all utility functions as '$' prefixed functions to control the local state                                                               |
| `throttle`                    | `Object`               |               | Lodash debounce options + `wait` key used to throttle all writes, set to falsy to disable                                                       |
| `idColumn='id'`               | `String`               | `'id'`        | Row ID column to sync with                                                                                                                      |
| `filter`                      | `Object`               |               | Query filter to use when accessing multiple rows                                                                                                |
| `dataColumn='data'`           | `String`               | `'data'`      | Data / JSONB column to sync data with                                                                                                           |
| `timestampColumn='edited_at'` | `String`               | `'edited_at'` | Timezone+TZ column to use when syncing data                                                                                                     |
| `versionColumn`               | `String`               |               | Optional version column, this increments on each write and is only really useful for debugging purposes                                         |
| `reactiveCreate`              | `Function`             |               | Async function used to create an observable / reactive data entity from its input. Defaults to Vue's reactive function                          |
| `reactiveWatch`               | `Function`             |               | Async function used to create a watch on the created reactive. Defaults to Vue's watch function                                                 |
| `onInit`                      | `Function`             |               | Async function when first populating data from the remote. Called as `(data:Object                                                              | Array)` |
| `onRead`                      | `Function`             |               | Async function called on subsequent reads when populating data from the remote. Called as `(data:Object                                         | Array)` |
| `onChange`                    | `Function`             |               | Async function called when a detected local write is about to be sent to the remote. Called as `(dataPayload:Object                             | Array)` |
| `onDestroy`                   | `Function`             |               | Async function called when destroying state. Called as `(data:Reactive)`                                                                        |
| `debug`                       | `Function` / `Boolean` |               | Optional debugging function callback. Called as `(...msg:Any)`                                                                                  |
| `splitPath`                   | `Function`             |               | Path parser, expected to decorate the `settings` object. Called as `(path: String, settings: Object)` and expected to mutate the settings state |


defaults
--------
Storage object for all defaults used by `SupabaseReactive`.


Reactive.$meta
--------------
Meta information about the current row.
This only really exists because we can't assign scalars in Javascript without it resetting the pointer later.

This object is made up of:

| Key         | Type              | Description                                                                                                   |
|-------------|-------------------|---------------------------------------------------------------------------------------------------------------|
| `id`        | `String`          | The ID of the current row                                                                                     |
| `table`     | `String`          | The active table for the current row                                                                          |
| `timestamp` | `Null` / `Date`   | The last known timestamp of data from the server (or NULL if no data has been pulled yet)                     |
| `If`        | `Null` / `Number` | a versioning column is enabled this represents the last known version of the data, similar to $meta.timestamp |
| `Whether`   | `Boolean`         | the state is being updated locally - indicates that local watchers should ignore incoming change detection    |


Reactive.$set(state, options)
-----------------------------
Sets the content of the current reactive.

Valid options are:

| Option         | Type      | Default | Description                                                                        |
|----------------|-----------|---------|------------------------------------------------------------------------------------|
| `markUpdating` | `Boolean` | `true`  | Mark the object as within an update to prevent recursion + disable local observers |
| `removeKeys`   | `Boolean` | `true`  | Clean out dead reactive keys if the new state doesn't also contain them            |
| `timestamp`    | `Date`    |         | Set the reactive timestamp if provided                                             |
| `version`      | `Number`  |         | Set the reactive version if provided                                               |


Reactive.$toObject()
--------------------
Tidy JSON field data so that is safe from private methods (anything starting with '$' or '_', proxies or other non POJO slush.
Returns a POJO.


Reactive.$refresh()
-------------------
Alias of `Reactive.$read()`.


Reactive.$getQuery()
--------------------
Generate a Supabase object representing a query for the current configuration.
Returns a Supabase promise which resolves when the operation has completed


Reactive.$init()
----------------
Initial operaton to wait on data from service + return reactable
This function is the default response when calling the outer `SupabaseReactive()` function.


Reactive.$read()
----------------
Fetch the current data state from the server and update the reactive.
Returns a promise.


Reactive.$fetch()
-----------------
Fetch the current data state from the server but don't update the local state.
This function is only really useful for snapshotting server state.
Returns a promise which resolves with the snapshot data.


Reactive.$watch(isWatching=true)
--------------------------------
Watch local data for changes and push to the server as needed.
Returns a promise.


Reactive.$flush()
-----------------
Wait for all local writes to complete.
NOTE: This only promises that local writes complete, not that a subsequent read is required.
Returns a promise.


Reactive.$subscribe(isSubscribed=true)
--------------------------------------
Toggle subscription to the realtime datafeed.
Returns a promise.


Reactive.$destroy()
-------------------
Release all watchers and subscriptions, local and remote.
Returns a promise.
