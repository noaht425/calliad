export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Example {
  task: string;
  messages: ChatMessage[];
}
