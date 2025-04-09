import { v4 as uuidv4 } from 'uuid';
import { DialogMessage, TranscriptionSegment, CallDialog } from '../models/Dialog';
import { TranslationServiceClient } from '@google-cloud/translate';

// Initialize Google Translate client
const translateClient = new TranslationServiceClient();

// Store active dialogs
const activeDialogs = new Map<string, CallDialog>();

/**
 * Create a new dialog for a call
 */
export function createDialog(callSid: string): CallDialog {
  const dialog: CallDialog = {
    callSid,
    messages: [],
    transcription: [],
    startTime: new Date()
  };
  
  activeDialogs.set(callSid, dialog);
  return dialog;
}

/**
 * Add a message to the dialog
 */
export async function addMessage(
  callSid: string,
  source: 'owner' | 'guest',
  originalText: string
): Promise<DialogMessage> {
  const dialog = activeDialogs.get(callSid);
  if (!dialog) {
    throw new Error(`Dialog not found for call ${callSid}`);
  }
  
  // Translate the text
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const location = 'global';
  
  const request = {
    parent: `projects/${projectId}/locations/${location}`,
    contents: [originalText],
    mimeType: 'text/plain',
    sourceLanguageCode: source === 'owner' ? 'en' : 'ru',
    targetLanguageCode: source === 'owner' ? 'ru' : 'en'
  };
  
  const [response] = await translateClient.translateText(request);
  const translation = response.translations?.[0]?.translatedText || '';
  
  const message: DialogMessage = {
    id: uuidv4(),
    timestamp: new Date(),
    source,
    originalText,
    translatedText: translation,
    callSid
  };
  
  dialog.messages.push(message);
  return message;
}

/**
 * Add a transcription segment
 */
export function addTranscription(
  callSid: string,
  text: string,
  isFinal: boolean = false
): TranscriptionSegment {
  const dialog = activeDialogs.get(callSid);
  if (!dialog) {
    throw new Error(`Dialog not found for call ${callSid}`);
  }
  
  const segment: TranscriptionSegment = {
    id: uuidv4(),
    timestamp: new Date(),
    text,
    callSid,
    isFinal
  };
  
  dialog.transcription.push(segment);
  return segment;
}

/**
 * End a dialog
 */
export function endDialog(callSid: string): void {
  const dialog = activeDialogs.get(callSid);
  if (dialog) {
    dialog.endTime = new Date();
    // Here you could save the dialog to a database
  }
}

/**
 * Get a dialog by call SID
 */
export function getDialog(callSid: string): CallDialog | undefined {
  return activeDialogs.get(callSid);
}

/**
 * Get all active dialogs
 */
export function getAllDialogs(): CallDialog[] {
  return Array.from(activeDialogs.values());
} 