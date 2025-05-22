# Voice Agent

A simple voice recording application that transcribes audio using OpenAI's Whisper API and integrates with N8N workflows.

## Features

- Voice recording in the browser
- Audio transcription using OpenAI Whisper
- N8N webhook integration
- Conversation history storage
- Simple and clean UI

## Prerequisites

- Node.js (v14 or higher)
- OpenAI API key
- N8N webhook URL

## Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd vagent
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```
OPENAI_API_KEY=your_openai_api_key_here
N8N_WEBHOOK_URL=your_n8n_webhook_url_here
PORT=3000
NODE_ENV=development
DB_PATH=./data/conversations.db
```

4. Create the data directory:
```bash
mkdir data
```

## Running the Application

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The application will be available at `http://localhost:3000`

## Usage

1. Open the application in your web browser
2. Click the "Start Recording" button to begin recording
3. Speak your message
4. Click "Stop Recording" to end the recording
5. The audio will be automatically transcribed and sent to your N8N workflow
6. The conversation history will be displayed below the recording button

## Security Notes

- Keep your `.env` file secure and never commit it to version control
- The application uses SQLite for local storage
- All API keys are stored server-side

## License

MIT
