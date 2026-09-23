// Plain-node test, no framework — run with: node test/send-email.test.js
// Stubs nodemailer's transport so this never touches a real SMTP connection —
// there is a live digest subscriber, and this must not risk sending them
// anything. Confirms lib/sendEmail.js's replyTo addition landed correctly
// without disturbing `from`, which the hello-elpys-mailbox-cutover task was
// explicit must stay built from GMAIL_USER unchanged.

const nodemailer = require('nodemailer');

let captured = null;
// Monkey-patch the cached nodemailer module's createTransport BEFORE
// lib/sendEmail.js requires it below — require() returns the same cached
// module object both times, so this substitution is in place by the time
// lib/sendEmail.js calls nodemailer.createTransport(...) at its own module
// scope.
nodemailer.createTransport = function () {
  return {
    sendMail: async (mail) => { captured = mail; return { messageId: 'stub' }; },
  };
};

process.env.GMAIL_USER = 'elpysnotifications@gmail.com';
process.env.GMAIL_APP_PASSWORD = 'stub-password-not-real';

const sendEmail = require('../lib/sendEmail');

let fails = 0;
const check = (label, cond, detail) => {
  if (!cond) { fails++; console.log('FAIL ' + label + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
  else console.log('ok   ' + label);
};

async function main() {
  console.log('=== sendEmail() carries the new Reply-To without changing from ===');
  await sendEmail({ to: 'subscriber@example.com', subject: 'Test', html: '<p>hi</p>', text: 'hi' });

  check('sendMail was called', captured !== null);
  check('replyTo is hello.elpys@gmail.com', captured && captured.replyTo === 'hello.elpys@gmail.com', captured && captured.replyTo);
  check('from is still built from GMAIL_USER', captured && captured.from === '"Elpys" <elpysnotifications@gmail.com>', captured && captured.from);
  check('to is passed through unchanged', captured && captured.to === 'subscriber@example.com', captured && captured.to);
  check('subject is passed through unchanged', captured && captured.subject === 'Test', captured && captured.subject);

  console.log('\n=== changing GMAIL_USER changes from, never replyTo ===');
  captured = null;
  process.env.GMAIL_USER = 'someone-else@gmail.com';
  await sendEmail({ to: 'subscriber2@example.com', subject: 'Test 2', html: '<p>hi</p>', text: 'hi' });
  check('from follows GMAIL_USER', captured && captured.from === '"Elpys" <someone-else@gmail.com>', captured && captured.from);
  check('replyTo is unaffected by GMAIL_USER', captured && captured.replyTo === 'hello.elpys@gmail.com', captured && captured.replyTo);

  console.log('\nFAILURES: ' + fails);
  process.exit(fails ? 1 : 0);
}

main();
