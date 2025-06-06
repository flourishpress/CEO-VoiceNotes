require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { OpenAI } = require('openai');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const winston = require('winston');

// Global error handlers for robust logging
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// Ensure data directory exists before opening SQLite DB
const dataDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
// Ensure uploads directory exists
const uploadsDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Trust Railway's proxy for correct client IP handling
app.set('trust proxy', 1);

console.log('Starting CEO Voice Notes server...');
console.log('Trust proxy set:', app.get('trust proxy'));

// Configure Winston logger
const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Add console transport in development
if (!isProduction) {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Rate limiting configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later'
});

// Apply rate limiting to all API routes
app.use('/api/', limiter);

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize SQLite database
const db = new sqlite3.Database(process.env.DB_PATH || './data/conversations.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1); // Exit if we can't connect to the database
  } else {
    console.log('Connected to SQLite database');
    // Create conversations table if it doesn't exist
    db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        transcript TEXT,
        n8n_response TEXT
      )
    `);
  }
});

// Configure multer for audio file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, `recording-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Accept audio files
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed!'), false);
    }
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('src/public'));

// Enhanced error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });
  
  res.status(500).json({ 
    error: isProduction ? 'Internal server error' : err.message 
  });
});

// Routes
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    // Validate request
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    logger.info('Processing audio file', {
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype
    });

    // Transcribe audio using OpenAI Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "gpt-4o-transcribe",
      response_format: "json"
    });

    // Send to N8N webhook
    const n8nResponse = await fetch(process.env.N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transcript: transcription.text })
    });

    if (!n8nResponse.ok) {
      throw new Error(`N8N webhook failed: ${n8nResponse.statusText}`);
    }

    const n8nData = await n8nResponse.json();

    // Store in database
    db.run(
      'INSERT INTO conversations (timestamp, transcript, n8n_response) VALUES (?, ?, ?)',
      [new Date().toISOString(), transcription.text, JSON.stringify(n8nData)],
      function(err) {
        if (err) {
          logger.error('Error storing conversation:', err);
        }
      }
    );

    // Clean up the uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      transcript: transcription.text,
      n8nResponse: n8nData
    });
  } catch (error) {
    logger.error('Error processing audio:', {
      error: error.message,
      stack: error.stack
    });
    // Also log to console for Railway visibility
    console.error('Error processing audio:', error);
    
    // Clean up the file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: isProduction ? 'Error processing audio' : error.message 
    });
  }
});

// Get conversation history
app.get('/api/conversations', (req, res) => {
  db.all('SELECT * FROM conversations ORDER BY timestamp DESC', [], (err, rows) => {
    if (err) {
      console.error('Error fetching conversations:', err);
      return res.status(500).json({ error: 'Error fetching conversations' });
    }
    res.json(rows);
  });
});

// Enhanced health check endpoint
app.get('/health', (req, res) => {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  };

  // Check database connection
  db.get('SELECT 1', (err) => {
    if (err) {
      healthCheck.status = 'unhealthy';
      healthCheck.database = 'error';
      return res.status(500).json(healthCheck);
    }
    healthCheck.database = 'connected';
    res.status(200).json(healthCheck);
  });
});

// Root endpoint for Railway health check
app.get('/', (req, res) => {
  res.status(200).send('CEO Voice Notes is running!');
});

// Start server
app.listen(port, () => {
  console.log(`Server running in ${isProduction ? 'production' : 'development'} mode on port ${port}`);
}); 