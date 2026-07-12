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

module.exports = async function sendEmail({ to, subject, html, text }) {
  await transporter.sendMail({
    from: `"Elpys" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
    text,
  });
};
