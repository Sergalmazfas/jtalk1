// scripts/twilioWebhookHandler.ts
import { Request, Response } from "express";

const webhookHandler = (req: Request, res: Response) => {
  console.log("✅ Twilio Webhook hit:", req.body);
  // Send a minimal valid TwiML response if required, or just status 200
  // For debugging, just send 200 OK
  res.status(200).type('text/plain').send("Webhook received by handler");
};

export default webhookHandler; 