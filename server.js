// server.js - Versão para a Nuvem (Render, Fly.io, etc.)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();

// Middlewares (seu código de CORS aqui está bom)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, Pragma');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

const server = http.createServer(app);

const io = new Server(server, {
    transports: ['websocket', 'polling'],
    cors: {
        origin: "*",
        methods: ["GET", "POST", "OPTIONS"]
    }
});

// A plataforma define a porta. Não defina como 3000 fixo.
const PORT = process.env.PORT || 3000;

// Armazenamento em memória (continua igual)
let activeStreamers = new Set();
let activeListeners = new Set();

// Toda a lógica do io.on('connection', ...) continua EXATAMENTE a mesma.
// Copie e cole toda a sua seção io.on('connection', (socket) => { ... }); aqui.
io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    // ... todos os seus eventos 'start-stream', 'audio-chunk', 'disconnect', etc. ...
    socket.on('get-status', () => {
        socket.emit('server-status', {
            streamers: activeStreamers.size,
            listeners: activeListeners.size,
            uptime: process.uptime(),
            timestamp: Date.now()
        });
    });

    socket.on('disconnect', () => {
        console.log('Usuario desconectado:', socket.id);
        if (activeStreamers.has(socket.id)) {
            activeStreamers.delete(socket.id);
            socket.to('listener').emit('streamer-stopped', { streamerId: socket.id });
        }
        if (activeListeners.has(socket.id)) {
            activeListeners.delete(socket.id);
        }
    });

    // ... adicione todos os outros eventos do socket.io aqui ...
});


// Endpoints HTTP (continua igual, mas removendo referências a IP local/UPnP)
app.get('/status', (req, res) => {
    res.json({
        status: 'running',
        streamers: activeStreamers.size,
        listeners: activeListeners.size,
        uptime: process.uptime(),
        version: '1.0.0-cloud'
    });
});

app.get('/', (req, res) => {
    res.send(`
        <h1>🎵 SyncMusic Server</h1>
        <p>Status: Rodando</p>
        <p>Streamers ativos: ${activeStreamers.size}</p>
        <p>Listeners ativos: ${activeListeners.size}</p>
        <p><a href="/status">Ver status em JSON</a></p>
    `);
});

// Inicialização simplificada do servidor
server.listen(PORT, () => {
    console.log(`🎵 SyncMusic Server rodando na porta ${PORT}`);
    console.log('📱 Servidor pronto para conexões!');
});

// REMOVA todas as funções: getLocalIP, setupUPnP, cleanupUPnP, tryGetPublicIPAlternative
// REMOVA todos os listeners de process.on('SIGINT'), etc, que chamam cleanupUPnP
