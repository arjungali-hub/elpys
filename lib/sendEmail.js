const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  pool: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// The account allowed to SEND (GMAIL_USER below) is deliberately not the
// account a person reads — it exists only to hold the SMTP credentials and
// is not monitored. This constant is the real, read mailbox: the one
// published everywhere else on the site, and the one a subscriber should
// actually reach if they hit reply. Hard-coded here rather than a new env
// var, matching the published address already being hard-coded in the HTML —
// an env var here is one more Vercel setting that can be forgotten.
const HELLO_ELPYS_EMAIL = 'hello.elpys@gmail.com';

module.exports = async function sendEmail({ to, subject, html, text }) {
  await transporter.sendMail({
    from: `"Elpys" <${process.env.GMAIL_USER}>`,
    replyTo: HELLO_ELPYS_EMAIL,
    to,
    subject,
    html,
    text,
  });
};
