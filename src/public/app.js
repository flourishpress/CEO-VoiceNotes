let mediaRecorder;
let audioChunks = [];
let isRecording = false;

const recordButton = document.getElementById('recordButton');
const recordingStatus = document.getElementById('recordingStatus');
const conversationList = document.getElementById('conversationList');

// Initialize
async function init() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            await sendAudioToServer(audioBlob);
            audioChunks = [];
        };

        loadConversationHistory();
    } catch (err) {
        console.error('Error accessing microphone:', err);
        recordingStatus.textContent = 'Error: Could not access microphone';
    }
}

// Toggle recording
function toggleRecording() {
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
}

function startRecording() {
    audioChunks = [];
    mediaRecorder.start();
    isRecording = true;
    recordButton.classList.add('recording');
    recordButton.innerHTML = '<span class="record-icon">⏹</span> Stop Recording';
    recordingStatus.textContent = 'Recording...';
}

function stopRecording() {
    mediaRecorder.stop();
    isRecording = false;
    recordButton.classList.remove('recording');
    recordButton.innerHTML = '<span class="record-icon">🎤</span> Start Recording';
    recordingStatus.textContent = 'Processing...';
}

// Send audio to server
async function sendAudioToServer(audioBlob) {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.wav');

    try {
        const response = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const data = await response.json();
        // addConversationToUI(data);
        loadConversationHistory(); // Refresh the conversation list
        recordingStatus.textContent = 'Recording processed successfully';
    } catch (error) {
        console.error('Error sending audio:', error);
        recordingStatus.textContent = 'Error processing recording';
    }
}

function stripMarkdown(md) {
    return md
        .replace(/[*_~`>#-]/g, '')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')
        .replace(/!\[(.*?)\]\(.*?\)/g, '$1')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .trim();
}

// Load conversation history
async function loadConversationHistory() {
    try {
        const response = await fetch('/api/conversations');
        const conversations = await response.json();
        
        // Reverse the array so the most recent is at the top
        conversationList.innerHTML = conversations.map(conv => {
            let n8nText;
            try {
                const n8nObj = JSON.parse(conv.n8n_response);
                n8nText = n8nObj.output ? stripMarkdown(n8nObj.output) : JSON.stringify(n8nObj, null, 2);
            } catch (e) {
                n8nText = conv.n8n_response;
            }
            const time = new Date(conv.timestamp).toLocaleTimeString();
            return `
                <div class="conversation-item">
                    <div class="bubble n8n">${n8nText}</div>
                    <div class="timestamp">${time}</div>
                    <div class="bubble user">${conv.transcript}</div>
                    <div class="timestamp">${time}</div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading conversations:', error);
    }
}

// Event listeners
recordButton.addEventListener('click', toggleRecording);

// Initialize the app
init(); 