require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const pdf = require('pdf-parse'); // For reading PDF files
const Tesseract = require('tesseract.js'); // For OCR
const OpenAI = require('openai'); // OpenAI library
const { readFileSync, writeFileSync, existsSync } = require('fs'); // For file operations
const port = process.env.PORT || 4000;

// Replace with your own Telegram bot token and OpenAI API key
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Initialize Telegram bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Initialize OpenAI API
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

// Function to read custom data from a TXT file (e.g., 'custom_data.txt')
const loadCustomData = () => {
    try {
        const customData = readFileSync('./custom_data.txt', 'utf8');
        return customData;
    } catch (error) {
        console.error("Error loading custom data:", error);
        return "Default custom instructions."; // Fallback in case of error
    }
};

// Load the custom data once at the start
const customData = loadCustomData();

// Memory object to store conversation history per user
let memory = {};

// Load memory from JSON file if it exists
const loadMemory = () => {
    if (existsSync('./memory.json')) {
        try {
            const data = readFileSync('./memory.json', 'utf8');
            if (data.trim() === '') {
                memory = {};
            } else {
                memory = JSON.parse(data);
            }
        } catch (error) {
            console.error('Error loading memory:', error);
            memory = {}; // Fallback to an empty object in case of error
        }
    } else {
        memory = {}; // If the file doesn't exist, initialize as empty
    }
};

// Save memory to a JSON file for persistence
const saveMemory = () => {
    try {
        writeFileSync('./memory.json', JSON.stringify(memory, null, 2));
    } catch (error) {
        console.error('Error saving memory:', error);
    }
};

// Load the memory at bot start
loadMemory();

// Store conversation history based on context and use case
const storeContextBasedMemory = (userId, contextType, userMessage) => {
    if (!memory[userId]) {
        memory[userId] = {};
    }
    if (!memory[userId][contextType]) {
        memory[userId][contextType] = [];
    }
    memory[userId][contextType].push(userMessage);

    // Save the updated memory
    saveMemory();
};

// Function to download the file from Telegram
const downloadFile = async (fileId) => {
    try {
        const fileLink = await bot.getFileLink(fileId);
        const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
        return response.data;
    } catch (error) {
        console.error('Error downloading file:', error);
        return null;
    }
};

// Function to read text from PDF
const readPdf = async (fileBuffer) => {
    try {
        const data = await pdf(fileBuffer);
        return data.text;
    } catch (error) {
        console.error('Error reading PDF:', error);
        return null;
    }
};

// Function to perform OCR on an image
const readImage = async (fileBuffer) => {
    try {
        const result = await Tesseract.recognize(fileBuffer, 'eng', {
            logger: info => console.log(info),
        });
        return result.data.text;
    } catch (error) {
        console.error('Error reading image:', error);
        return null;
    }
};

// Function to analyze content with OpenAI
const analyzeFileWithOpenAI = async (fileContent, userId, contextType) => {
    try {
        const conversationHistory = memory[userId]?.[contextType]?.join('\n') || '';
        const response = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                { role: "system", content: customData },
                { role: "user", content: "Here is the context from previous conversations: " + conversationHistory },
                { role: "user", content: "Please analyze this content: " + fileContent },
            ],
            temperature: 0.7,
            max_tokens: 150,
        });
        return response.choices[0].message.content;
    } catch (error) {
        console.error('Error analyzing file with OpenAI:', error);
        return "I'm sorry, I couldn't analyze the file.";
    }
};

// Function to handle text messages (chatbot functionality)
const handleTextMessage = async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userMessage = msg.text;

    const contextType = 'general'; // Could be expanded for different contexts

    // Store message with context
    storeContextBasedMemory(userId, contextType, userMessage);

    try {
        const conversationHistory = memory[userId]?.[contextType]?.join('\n') || '';
        const response = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                { role: "system", content: customData }, // Custom data as system prompt
                { role: "user", content: "Conversation so far: " + conversationHistory },
                { role: "user", content: userMessage },
            ],
            temperature: 0.7,
            max_tokens: 150,
        });

        const botResponse = response.choices[0].message.content;
        await bot.sendMessage(chatId, botResponse);
    } catch (error) {
        console.error('Error processing text message:', error);
        bot.sendMessage(chatId, "I'm sorry, I couldn't process your request.");
    }
};

// Function to handle documents (PDFs, images, etc.)
const handleDocument = async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const fileId = msg.document.file_id;

    // Download the file
    const fileBuffer = await downloadFile(fileId);
    if (!fileBuffer) {
        await bot.sendMessage(chatId, "Sorry, I couldn't download the file.");
        return;
    }

    // Determine the file type (PDF or image) and process accordingly
    const fileName = msg.document.file_name.toLowerCase();
    let fileContent = '';

    if (fileName.endsWith('.pdf')) {
        fileContent = await readPdf(fileBuffer);
    } else if (fileName.endsWith('.png') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
        fileContent = await readImage(fileBuffer);
    }

    if (!fileContent) {
        await bot.sendMessage(chatId, "Sorry, I couldn't process the file.");
        return;
    }

    // Analyze the file content with OpenAI
    const analysisResult = await analyzeFileWithOpenAI(fileContent, userId, 'file_analysis');
    await bot.sendMessage(chatId, analysisResult);
};

// Listen for text messages (chatbot functionality)
bot.on('message', async (msg) => {
    if (msg.text && !msg.document && !msg.photo) {
        await handleTextMessage(msg);
    } else if (msg.document) {
        await handleDocument(msg); // Handle document uploads
    }
});

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
  })

console.log('Telegram bot is running...');
