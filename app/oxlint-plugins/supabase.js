/**
 * Custom oxlint JS plugin (ESLint-compatible): `supabase/require-error-check`.
 *
 * Every awaited Supabase call resolves to `{ data, error }` (PostgREST-style:
 * HTTP failures do NOT throw, they land in `error`). Destructuring only
 * `data` — or discarding the result entirely — silently swallows failures
 * (auth errors, RLS denials, network blips) and turns them into confusing
 * downstream behavior (empty lists, "not authenticated" loops, stale UI).
 *
 * This rule fails `npm run lint` (and therefore the PR gates) for any
 * `await <supabase …>` whose `error` is never read:
 *
 *   BAD:  const { data } = await supabase.from('coasters').select('*')
 *   GOOD: const { data, error } = await supabase.from('coasters').select('*')
 *         if (error) throw error
 *
 * Deliberately syntactic (no type information — oxlint JS plugins cannot be
 * type-aware). Known limitations, documented rather than fixed:
 *  - Pre-built query builders (`const q = supabase.from(…); …; await q`)
 *    are not traced; only the awaited expression is inspected.
 *  - `.then()` chains are not inspected; use `await`.
 *  - A result object passed wholesale to another function or returned to the
 *    caller counts as handled (error handling is delegated, not skipped).
 *  - `Promise.allSettled` / `Promise.race` results are skipped (different
 *    result shape). `Promise.all` + array destructuring IS checked.
 *  - Sync helpers with no `error` field are allowlisted: `getPublicUrl`,
 *    `onAuthStateChange`, `throwOnError` (throws instead of returning error).
 */

const PLUGIN_NAME = 'supabase'
const RULE_NAME = 'require-error-check'

const EXCLUDED_TERMINALS = new Set(['getPublicUrl', 'onAuthStateChange', 'throwOnError'])

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
])

const TS_WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
])

function propName(member) {
  const p = member.property
  if (!p) return null
  if (p.type === 'Identifier') return member.computed ? null : p.name
  if (p.type === 'Literal' && typeof p.value === 'string') return p.value
  return null
}

/** Unwrap TS `as` / `satisfies` / `!` casts and legacy `ChainExpression`. */
function unwrap(node) {
  let current = node
  while (current && (TS_WRAPPERS.has(current.type) || current.type === 'ChainExpression')) {
    current = current.expression
  }
  // `await await supabase…` collapses; check the innermost expression.
  while (current && current.type === 'AwaitExpression') {
    let inner = current.argument
    while (inner && (TS_WRAPPERS.has(inner.type) || inner.type === 'ChainExpression')) {
      inner = inner.expression
    }
    current = inner
  }
  return current
}

/**
 * Walk the callee chain of a CallExpression down to its root identifier.
 * Handles builder chains (`supabase.from('x').select('*').eq(…)`) where each
 * link's object is the previous CallExpression.
 */
function rootOfCall(call) {
  let callee = call.callee
  let outerMethod = null
  let first = true
  while (callee) {
    if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
      if (first) {
        outerMethod = propName(callee)
        first = false
      }
      callee = callee.object
    } else if (callee.type === 'CallExpression' || callee.type === 'OptionalCallExpression') {
      callee = callee.callee
    } else if (callee.type === 'ChainExpression' || TS_WRAPPERS.has(callee.type)) {
      callee = callee.expression
    } else {
      break
    }
  }
  return { root: callee && callee.type === 'Identifier' ? callee.name : null, outerMethod }
}

function isPromiseCombinator(call, name) {
  const c = call.callee
  return (
    (c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression') &&
    c.object.type === 'Identifier' &&
    c.object.name === 'Promise' &&
    propName(c) === name
  )
}

/**
 * Collect the outermost `supabase.…(…)` calls under `node`. A call whose
 * callee chain bottoms out at the `supabase` identifier is a terminal: its
 * siblings in the chain (e.g. `.from('x')` inside `.from('x').select('*')`)
 * are not collected separately. Never descends into nested function scopes —
 * an `await supabase…` inside an IIFE/callback is visited on its own by the
 * `AwaitExpression` handler (e.g. the best-effort board-meta IIFE passed to
 * `Promise.all`, which handles its own error internally).
 */
function collectSupabaseTerminals(node, out) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const element of node) collectSupabaseTerminals(element, out)
    return
  }
  if (typeof node.type !== 'string') return
  if (FUNCTION_TYPES.has(node.type)) return
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
    const { root, outerMethod } = rootOfCall(node)
    if (root === 'supabase') {
      out.push({ node, outerMethod })
      return
    }
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue
    const value = node[key]
    if (value && typeof value === 'object') collectSupabaseTerminals(value, out)
  }
}

/** True when `node` awaits a Supabase call whose `error` must be read. */
function requiresErrorCheck(node) {
  const terminals = []
  collectSupabaseTerminals(unwrap(node), terminals)
  return terminals.some((terminal) => !EXCLUDED_TERMINALS.has(terminal.outerMethod))
}

function patternReadsError(pattern) {
  return pattern.properties.some((prop) => {
    // `const { data, ...rest } = await …` captures `error` inside `rest`.
    if (prop.type === 'RestElement') return true
    if (prop.type !== 'Property') return false
    const key = prop.key
    const name =
      key.type === 'Identifier' && !prop.computed
        ? key.name
        : key.type === 'Literal'
          ? String(key.value)
          : null
    return name === 'error'
  })
}

function collectBindingNames(node, out) {
  if (!node) return
  if (node.type === 'Identifier') {
    out.push(node.name)
  } else if (node.type === 'ObjectPattern') {
    for (const p of node.properties) {
      if (p.type === 'RestElement') collectBindingNames(p.argument, out)
      else if (p.type === 'Property') collectBindingNames(p.value, out)
    }
  } else if (node.type === 'ArrayPattern') {
    for (const el of node.elements) collectBindingNames(el, out)
  } else if (node.type === 'AssignmentPattern') {
    collectBindingNames(node.left, out)
  } else if (node.type === 'RestElement') {
    collectBindingNames(node.argument, out)
  }
}

function collectErrorNames(pattern) {
  const names = []
  for (const prop of pattern.properties) {
    if (prop.type !== 'Property') continue
    const key = prop.key
    const name =
      key.type === 'Identifier' && !prop.computed
        ? key.name
        : key.type === 'Literal'
          ? String(key.value)
          : null
    if (name === 'error') collectBindingNames(prop.value, names)
  }
  return names
}

function lookupVariable(sourceCode, scopeNode, name) {
  let scope = sourceCode.getScope(scopeNode)
  while (scope) {
    const variable = scope.set.get(name)
    if (variable) return variable
    scope = scope.upper
  }
  return null
}

/**
 * A whole-result variable (`const res = await supabase…`) counts as handled
 * when `error` is observably read off it, or the result is handed to the
 * caller (return) / another function for handling.
 */
function isResultHandled(variable) {
  return variable.references.some((ref) => {
    if (!ref.isRead()) return false
    const id = ref.identifier
    const parent = id.parent
    if (!parent) return false
    // `res.error`
    if (
      (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') &&
      parent.object === id &&
      propName(parent) === 'error'
    ) {
      return true
    }
    // `const { error } = res` (or `const { data } = res` — no: must include error)
    if (
      parent.type === 'VariableDeclarator' &&
      parent.init === id &&
      parent.id.type === 'ObjectPattern' &&
      patternReadsError(parent.id)
    ) {
      return true
    }
    // `return res` / `throw res` / `fn(res)` / `wrap(res)` / `{ res }` —
    // error handling is delegated to the caller/callee, not skipped.
    if (parent.type === 'ReturnStatement' || parent.type === 'ThrowStatement') return true
    if (parent.type === 'CallExpression' && parent.arguments.includes(id)) return true
    if (parent.type === 'Property' && parent.value === id) return true
    if (parent.type === 'ArrayExpression' || parent.type === 'SpreadElement') return true
    return false
  })
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require the `error` of every awaited Supabase call to be read (destructure `error` and handle it).',
    },
    messages: {
      missingError:
        'Supabase call result does not read `error`. Destructure `error` and handle it (e.g. `if (error) throw error`).',
      unreadError:
        'Supabase `error` ({{names}}) is destructured but never read. Handle it (e.g. `if (error) throw error`).',
      resultErrorUnchecked:
        'Supabase result `{{name}}` never reads `.error`. Destructure `error` from it and handle it (e.g. `if ({{name}}.error) throw {{name}}.error`).',
      discardedResult:
        'Supabase call result is discarded, so `error` is never read. Await into a variable, destructure `error`, and handle it.',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode

    function checkObjectPattern(node, reportNode, pattern) {
      const names = collectErrorNames(pattern)
      if (names.length === 0) {
        context.report({ node: reportNode, messageId: 'missingError' })
        return
      }
      const unread = names.filter((name) => {
        const variable = lookupVariable(sourceCode, node, name)
        // Unresolvable binding: stay silent rather than crash the lint run.
        if (!variable) return false
        return !variable.references.some((ref) => ref.isRead())
      })
      if (unread.length > 0) {
        context.report({
          node: reportNode,
          messageId: 'unreadError',
          data: { names: unread.join(', ') },
        })
      }
    }

    function checkIdentifierResult(node, reportNode, name) {
      const variable = lookupVariable(sourceCode, node, name)
      if (!variable) return
      if (!isResultHandled(variable)) {
        context.report({ node: reportNode, messageId: 'resultErrorUnchecked', data: { name } })
      }
    }

    /** Shared handling for one awaited Supabase call site. */
    function checkSingleSupabaseAwait(awaitNode, supabaseExpr, reportNode) {
      void supabaseExpr
      const parent = awaitNode.parent
      if (parent.type === 'VariableDeclarator' && parent.init === awaitNode) {
        if (parent.id.type === 'ObjectPattern') {
          checkObjectPattern(awaitNode, reportNode, parent.id)
          return
        }
        if (parent.id.type === 'Identifier') {
          checkIdentifierResult(awaitNode, reportNode, parent.id.name)
          return
        }
        return // exotic pattern (array/rest of a single result): skip.
      }
      if (parent.type === 'ExpressionStatement') {
        context.report({ node: reportNode, messageId: 'discardedResult' })
        return
      }
      // `return await supabase…` / `() => await supabase…` / `await await …`:
      // the whole `{ data, error }` reaches the caller, which must check it.
      if (
        parent.type === 'ReturnStatement' ||
        parent.type === 'ArrowFunctionExpression' ||
        parent.type === 'AwaitExpression'
      ) {
        return
      }
      if (
        parent.type === 'AssignmentExpression' &&
        parent.right === awaitNode &&
        parent.left.type === 'Identifier' &&
        parent.operator === '='
      ) {
        checkIdentifierResult(awaitNode, reportNode, parent.left.name)
        return
      }
      // Call args, property values, template literals, …: conservative pass.
    }

    function checkPromiseAll(awaitNode, allCall) {
      const args = allCall.arguments
      if (args.length === 0 || args[0].type !== 'ArrayExpression') return
      const parent = awaitNode.parent
      const destructure =
        parent.type === 'VariableDeclarator' &&
        parent.init === awaitNode &&
        parent.id.type === 'ArrayPattern'
          ? parent.id
          : null
      if (!destructure) {
        // `await Promise.all([supabase…])` as a bare statement discards everything.
        if (parent.type === 'ExpressionStatement') {
          const hasSupabase = args[0].elements.some(
            (el) => el && el.type !== 'SpreadElement' && requiresErrorCheck(el),
          )
          if (hasSupabase) {
            context.report({ node: awaitNode, messageId: 'discardedResult' })
          }
        }
        return // assigned wholesale (`const r = await Promise.all…`): skip (see limitations).
      }
      args[0].elements.forEach((element, index) => {
        if (!element || element.type === 'SpreadElement') return
        if (!requiresErrorCheck(element)) return
        const patternEl = destructure.elements[index] ?? null
        if (!patternEl) {
          // Hole (`const [a, , c]`): element result is dropped.
          context.report({ node: element, messageId: 'missingError' })
          return
        }
        if (patternEl.type === 'ObjectPattern') {
          checkObjectPattern(awaitNode, element, patternEl)
          return
        }
        let target = patternEl
        if (target.type === 'AssignmentPattern') target = target.left
        if (target.type === 'Identifier') {
          checkIdentifierResult(awaitNode, element, target.name)
        }
        // RestElement / nested ArrayPattern: conservative pass.
      })
    }

    return {
      AwaitExpression(awaitNode) {
        // Inner `await` already accounted for by an enclosing `Promise.all`
        // handler — the outer destructuring owns the error check.
        const parent = awaitNode.parent
        if (
          parent.type === 'ArrayExpression' &&
          parent.parent &&
          parent.parent.type === 'CallExpression' &&
          isPromiseCombinator(parent.parent, 'all')
        ) {
          return
        }
        const unwrapped = unwrap(awaitNode.argument)
        if (unwrapped && unwrapped.type === 'CallExpression') {
          if (isPromiseCombinator(unwrapped, 'all')) {
            checkPromiseAll(awaitNode, unwrapped)
            return
          }
          if (
            isPromiseCombinator(unwrapped, 'allSettled') ||
            isPromiseCombinator(unwrapped, 'race') ||
            isPromiseCombinator(unwrapped, 'any')
          ) {
            return
          }
        }
        if (!requiresErrorCheck(awaitNode.argument)) return
        checkSingleSupabaseAwait(awaitNode, awaitNode.argument, awaitNode)
      },
    }
  },
}

const plugin = {
  meta: { name: PLUGIN_NAME },
  rules: { [RULE_NAME]: rule },
}

export default plugin
