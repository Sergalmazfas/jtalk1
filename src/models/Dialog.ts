export interface DialogMessage {
  id: string;
  timestamp: Date;
  source: 'owner' | 'guest';
  originalText: string;
  translatedText: string;
  callSid: string;
}

export interface TranscriptionSegment {
  id: string;
  timestamp: Date;
  text: string;
  callSid: string;
  isFinal: boolean;
}

export interface CallDialog {
  callSid: string;
  messages: DialogMessage[];
  transcription: TranscriptionSegment[];
  startTime: Date;
  endTime?: Date;
} 