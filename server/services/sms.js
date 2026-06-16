let twilioClient = null;

function getTwilioClient() {
  if (twilioClient) return twilioClient;
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return null;
  }
  twilioClient = require('twilio')(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  return twilioClient;
}

async function sendEmergencySMS(to, payload) {
  const client = getTwilioClient();
  const body = `AccessLink HELP: ${payload.userName} needs ${payload.needs || 'assistance'}. "${payload.message}" Location: ${payload.mapsUrl}`;

  if (!client || !process.env.TWILIO_PHONE_NUMBER) {
    console.log(`[SMS MOCK] To: ${to} | ${body}`);
    return { sent: false, mock: true };
  }

  await client.messages.create({
    body,
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
  });

  return { sent: true };
}

module.exports = { sendEmergencySMS };
