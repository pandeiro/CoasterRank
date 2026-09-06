import { describe, it } from 'vitest'
import { RuleTester } from 'oxlint/plugins-dev'
import plugin from './supabase.js'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })
const rule = plugin.rules['require-error-check']

ruleTester.run('require-error-check', rule, {
  valid: [
    // Classic handled call.
    `async function f() { const { data, error } = await supabase.from('coasters').select('*'); if (error) throw error; return data; }`,
    // Renamed error binding that is read.
    `async function f() { const { data: park, error: parkError } = await supabase.from('parks').select('slug').maybeSingle(); if (parkError) throw parkError; return park; }`,
    // Whole-result variable with .error read.
    `async function f() { const res = await supabase.from('x').select('*'); if (res.error) throw res.error; return res.data; }`,
    // Whole-result destructured for error later.
    `async function f() { const res = await supabase.from('x').select('*'); const { error } = res; if (error) throw error; return res.data; }`,
    // Returned to the caller: error handling is delegated, not skipped.
    `async function f() { return await supabase.from('coasters').select('*'); }`,
    // Sync helper with no error field.
    `async function f() { const { data } = supabase.storage.from('b').getPublicUrl('p'); return data; }`,
    // Subscription helper with no error field.
    `async function f() { const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {}); return subscription; }`,
    // throwOnError() throws instead of returning error.
    `async function f() { const data = await supabase.from('x').select('*').throwOnError(); return data; }`,
    // Promise.all with every element's error checked.
    `async function f() { const [a, b] = await Promise.all([supabase.from('x').select('*'), supabase.from('y').select('*')]); if (a.error) throw a.error; if (b.error) throw b.error; return [a.data, b.data]; }`,
    // Best-effort IIFE inside Promise.all handles its own error internally;
    // the outer element is not itself a Supabase call.
    `async function f() { const meta = await Promise.all([(async () => { const { data, error } = await supabase.rpc('m'); if (error) return null; return data; })()]); return meta; }`,
    // Non-Supabase awaits are ignored.
    `async function f() { const res = await fetch('/api/ranking'); return res.json(); }`,
  ],
  invalid: [
    {
      name: 'data-only destructure',
      code: `async function f() { const { data } = await supabase.from('coasters').select('*'); return data; }`,
      errors: [{ messageId: 'missingError', line: 1 }],
    },
    {
      name: 'destructured but unread error',
      code: `async function f() { const { data, error } = await supabase.from('x').select('*'); return data; }`,
      errors: [{ messageId: 'unreadError', line: 1 }],
    },
    {
      name: 'discarded result',
      code: `async function f() { await supabase.auth.signOut(); }`,
      errors: [{ messageId: 'discardedResult', line: 1 }],
    },
    {
      name: 'whole-result variable without .error read',
      code: `async function f() { const parkRes = await supabase.from('parks').select('slug').maybeSingle(); return parkRes.data; }`,
      errors: [{ messageId: 'resultErrorUnchecked', line: 1 }],
    },
    {
      name: 'nested data destructure without error (getUser shape)',
      code: `async function f() { const { data: { user } } = await supabase.auth.getUser(); if (!user) throw new Error('x'); }`,
      errors: [{ messageId: 'missingError', line: 1 }],
    },
    {
      name: 'Promise.all element without error',
      code: `async function f() { const [{ data: park }, other] = await Promise.all([supabase.from('parks').select('slug').maybeSingle(), fetchOther()]); return [park, other]; }`,
      errors: [{ messageId: 'missingError', line: 1 }],
    },
  ],
})
