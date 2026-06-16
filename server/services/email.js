const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

async function sendEmergencyEmail(to, recipientName, payload) {
  const transport = getTransporter();
  if (!transport) {
    console.log(`[EMAIL MOCK] To: ${to} | Emergency from ${payload.userName}: ${payload.message}`);
    return { sent: false, mock: true };
  }

  const html = `
    <h2>AccessLink Emergency Help Request</h2>
    <p>Hi ${recipientName},</p>
    <p><strong>${payload.userName}</strong> needs assistance nearby.</p>
    <ul>
      <li><strong>Message:</strong> ${payload.message}</li>
      <li><strong>Needs:</strong> ${payload.needs || 'Not specified'}</li>
      <li><strong>Location:</strong> <a href="${payload.mapsUrl}">View on map</a></li>
      ${payload.userPhone ? `<li><strong>Phone:</strong> ${payload.userPhone}</li>` : ''}
    </ul>
    <p>Request ID: #${payload.requestId}</p>
  `;

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: `[AccessLink] Emergency help needed – ${payload.needs || 'Assistance requested'}`,
    html,
  });

  return { sent: true };
}

module.exports = { sendEmergencyEmail };
