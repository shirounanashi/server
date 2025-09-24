// server.js - VERSÃO COMPLETA PARA DEPURAÇÃO NO RENDER
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();

// Middlewares
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
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },

  // --- CONFIGURAÇÃO ROBUSTA PARA PROXIES ---

  // 1. Força o uso de WebSocket primeiro, que é mais eficiente.
  transports: ['websocket', 'polling'],

  // 2. Aumenta o tempo de espera pela resposta do cliente para 30 segundos.
  // O padrão (5s) é muito baixo para redes móveis + proxies.
  pingTimeout: 30000,

  // 3. Envia um "ping" para o cliente a cada 15 segundos.
  // Isso mantém a conexão "viva" através de firewalls e proxies.
  // O padrão (25s) é muito longo e permite que a conexão seja derrubada.
  pingInterval: 15000,

  // 4. Mantém a flag de compatibilidade que ajuda com alguns proxies.
  allowEIO3: true
});

const PORT = process.env.PORT || 3000;

// Armazenamento em memória
let activeStreamers = new Set();
let activeListeners = new Set();

io.on('connection', (socket) => {
    // [MUDANÇA PARA DEPURAÇÃO] Log detalhado de conexão
    console.log(`[CONNECT] Socket ${socket.id} conectado.`);

    socket.on('start-stream', () => {
        // [MUDANÇA PARA DEPURAÇÃO] Log de evento
        console.log(`[EVENT start-stream] recebido de ${socket.id}`);
        socket.join('streamer');
        activeStreamers.add(socket.id);
        console.log(`${socket.id} iniciou streaming. Streamers ativos: ${activeStreamers.size}`);
        socket.to('listener').emit('streamer-started', { streamerId: socket.id });
    });

    socket.on('join-stream', () => {
        // [MUDANÇA PARA DEPURAÇÃO] Log de evento
        console.log(`[EVENT join-stream] recebido de ${socket.id}`);
        socket.join('listener');
        activeListeners.add(socket.id);
        console.log(`${socket.id} entrou como listener. Listeners ativos: ${activeListeners.size}`);
        if (activeStreamers.size > 0) {
            socket.emit('streamer-available', { streamersCount: activeStreamers.size });
        }
    });

    socket.on('audio-chunk', (chunk) => {
        // [MUDANÇA PARA DEPURAÇÃO] Log de evento com tamanho do chunk
        const chunkSize = chunk ? (chunk.byteLength || chunk.length) : 0;
        console.log(`[EVENT audio-chunk] recebido de ${socket.id} | Tamanho: ${chunkSize} bytes`);

        if (activeStreamers.has(socket.id)) {
            // [MUDANÇA PARA DEPURAÇÃO] A linha principal de retransmissão foi desativada para o teste.
            // O objetivo é ver se as desconexões param quando o servidor não precisa retransmitir os dados.
            // socket.to('listener').emit('audio-chunk', chunk);
            console.log('[DEBUG] Retransmissão de audio-chunk DESATIVADA para teste.');
        }
    });

    socket.on('stop-stream', () => {
        // [MUDANÇA PARA DEPURAÇÃO] Log de evento
        console.log(`[EVENT stop-stream] recebido de ${socket.id}`);
        if (activeStreamers.has(socket.id)) {
            activeStreamers.delete(socket.id);
            socket.leave('streamer');
            console.log(`${socket.id} parou streaming. Streamers ativos: ${activeStreamers.size}`);
            socket.to('listener').emit('streamer-stopped', { streamerId: socket.id });
        }
    });

    socket.on('get-status', () => {
        // [MUDANÇA PARA DEPURAÇÃO] Log de evento
        console.log(`[EVENT get-status] recebido de ${socket.id}`);
        socket.emit('server-status', {
            streamers: activeStreamers.size,
            listeners: activeListeners.size,
            uptime: process.uptime()
        });
    });

    socket.on('error', (error) => {
        // [MUDANÇA PARA DEPURAÇÃO] Log de erro específico do socket
        console.error(`[ERROR] Erro no socket ${socket.id}:`, error);
    });

    socket.on('disconnect', (reason) => {
        // [MUDANÇA PARA DEPURAÇÃO] Log de desconexão com o MOTIVO, essencial para depurar
        console.log(`[DISCONNECT] Socket ${socket.id} desconectado | Motivo: ${reason}`);

        if (activeStreamers.has(socket.id)) {
            activeStreamers.delete(socket.id);
            socket.to('listener').emit('streamer-stopped', { streamerId: socket.id, reason: 'disconnect' });
        }
        if (activeListeners.has(socket.id)) {
            activeListeners.delete(socket.id);
        }
        console.log(`Status após desconexão - Streamers: ${activeStreamers.size}, Listeners: ${activeListeners.size}`);
    });
});

// Endpoints HTTP
app.get('/status', (req, res) => {
    res.json({
        status: 'running',
        streamers: activeStreamers.size,
        listeners: activeListeners.size,
        uptime: process.uptime(),
        version: '1.0.0-cloud-debug'
    });
});

app.get('/', (req, res) => {
    res.send(`
        <h1>🎵 SyncMusic Server (Modo de Depuração)</h1>
        <p>Status: Rodando</p>
        <p>Streamers ativos: ${activeStreamers.size}</p>
        <p>Listeners ativos: ${activeListeners.size}</p>
    `);
});

// Inicialização do servidor
server.listen(PORT, () => {
    console.log(`🎵 SyncMusic Server (Modo de Depuração) rodando na porta ${PORT}`);
    console.log('📱 Servidor pronto para conexões!');
});
