// Step 4: grade one answer against its test's checks.

const RANK = { pass: 0, needs_review: 1, fail: 2, error: 3 };

export function worst(statuses) {
  return statuses.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'pass');
}

function gradeRule(check, output) {
  const text = output.toLowerCase();
  switch (check.type) {
    case 'contains':
      return text.includes(check.value.toLowerCase())
        ? { status: 'pass' }
        : { status: 'fail', reason: `Answer does not mention "${check.value}".` };
    case 'not_contains':
      return text.includes(check.value.toLowerCase())
        ? { status: 'fail', reason: `Answer says "${check.value}", which it must not.` }
        : { status: 'pass' };
    case 'regex':
      return new RegExp(check.value, 'i').test(output)
        ? { status: 'pass' }
        : { status: 'fail', reason: `Answer does not match the pattern /${check.value}/.` };
    default:
      return { status: 'error', reason: `Unknown check type "${check.type}".` };
  }
}

export async function gradeAnswer(test, output, judge) {
  const checks = [];
  for (const check of test.checks) {
    let result;
    if (check.type !== 'judge') result = gradeRule(check, output);
    else if (!judge) result = { status: 'needs_review', reason: 'Judge is off; a person must compare the answer with the expected behaviour.' };
    else result = await judge({ input: test.input, expected: check.value, output });
    checks.push({ ...check, ...result });
  }
  return { status: worst(checks.map(c => c.status)), checks };
}
