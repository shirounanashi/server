const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const natUpnp = require('nat-upnp');
const os = require('os');

const app = express();

// Middleware crítico para provedores externos
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, Pragma');
    res.header('Access-Control-Allow-Credentials', 'false');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

const server = http.createServer(app);

// --- MUDANÇA PRINCIPAL AQUI ---
const io = new Server(server, {
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    cors: {
        origin: "*",
        methods: ["GET", "POST", "OPTIONS"]
    }
});
// --- FIM DA MUDANÇA ---

const PORT = process.env.PORT || 3000;
const client = natUpnp.createClient();

// Variáveis para UPnP e conectividade
let upnpEnabled = false;
let publicIP = null;
let localIP = null;

// Armazenar informações sobre streamers e listeners
let activeStreamers = new Set();
let activeListeners = new Set();

// Função para obter IP local
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const interface of interfaces[name]) {
            if (interface.family === 'IPv4' && !interface.internal) {
                return interface.address;
            }
        }
    }
    return '127.0.0.1';
}

// Função melhorada para configurar UPnP
async function setupUPnP() {
    try {
        console.log('🔄 Tentando configurar UPnP...');

        // Obter IP local primeiro
        localIP = getLocalIP();
        console.log(`🏠 IP local detectado: ${localIP}`);

        // Tentar descobrir IP público via UPnP
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout ao detectar IP público'));
            }, 10000);

            client.externalIp((err, ip) => {
                clearTimeout(timeout);
                if (err) {
                    console.log('❌ UPnP não disponível:', err.message);
                    reject(err);
                } else {
                    publicIP = ip;
                    console.log(`🌐 IP público detectado via UPnP: ${ip}`);
                    resolve(ip);
                }
            });
        });

        // Mapear porta via UPnP
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout ao configurar port mapping'));
            }, 15000);

            client.portMapping({
                public: PORT,
                private: PORT,
                ttl: 7200, // 2 horas
                protocol: 'tcp',
                description: 'SyncMusic Server'
            }, (err) => {
                clearTimeout(timeout);
                if (err) {
                    console.log('❌ Falha ao configurar port mapping:', err.message);
                    reject(err);
                } else {
                    upnpEnabled = true;
                    console.log(`✅ UPnP configurado! Porta ${PORT} mapeada`);
                    console.log(`🌍 Servidor acessível externamente em: http://${publicIP}:${PORT}`);
                    resolve();
                }
            });
        });

    } catch (error) {
        console.log('⚠️  UPnP falhou:', error.message);
        console.log('📝 Configuração manual necessária:');
        console.log(`   - No router: redirecionar porta ${PORT} para ${localIP}:${PORT}`);
        console.log(`   - IP local para configurar: ${localIP}`);

        // Tentar descobrir IP público por outros métodos
        await tryGetPublicIPAlternative();
    }
}

// Método alternativo para descobrir IP público
async function tryGetPublicIPAlternative() {
    try {
        const https = require('https');

        console.log('🔍 Tentando descobrir IP público por método alternativo...');

        const getIP = () => new Promise((resolve, reject) => {
            const req = https.request({
                hostname: 'api.ipify.org',
                port: 443,
                path: '/',
                method: 'GET',
                timeout: 5000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data.trim()));
            });

            req.on('error', reject);
            req.on('timeout', () => reject(new Error('Timeout')));
            req.end();
        });

        publicIP = await getIP();
        console.log(`🌐 IP público descoberto: ${publicIP}`);
        console.log(`⚠️  Configure port forwarding manualmente no router:`);
        console.log(`   Porta externa: ${PORT} → IP interno: ${localIP}:${PORT}`);

    } catch (error) {
        console.log('❌ Não foi possível descobrir IP público automaticamente');
        console.log('📝 Descubra seu IP público em: https://whatismyipaddress.com/');
    }
}

io.on('connection', (socket) => {
    const clientIP = socket.handshake.headers['x-forwarded-for'] ||
        socket.handshake.address ||
        socket.conn.remoteAddress;

    console.log(`Usuario conectado: ${socket.id} de ${clientIP}`);

    // Emissor inicia streaming
    socket.on('start-stream', () => {
        socket.join('streamer');
        activeStreamers.add(socket.id);
        console.log(`${socket.id} iniciou streaming. Streamers ativos: ${activeStreamers.size}`);

        // Notificar listeners que um streamer está ativo
        socket.to('listener').emit('streamer-started', {
            streamerId: socket.id,
            timestamp: Date.now()
        });
    });

    // Receptor se junta para ouvir
    socket.on('join-stream', () => {
        socket.join('listener');
        activeListeners.add(socket.id);
        console.log(`${socket.id} entrou como listener. Listeners ativos: ${activeListeners.size}`);

        // Informar ao listener se há streamers ativos
        if (activeStreamers.size > 0) {
            socket.emit('streamer-available', {
                streamersCount: activeStreamers.size
            });
        }
    });

    // Retransmitir chunks de áudio
    socket.on('audio-chunk', (chunk) => {
        // Verificar se o socket está na sala de streamer
        if (activeStreamers.has(socket.id)) {
            // Emitir para todos os listeners
            socket.to('listener').emit('audio-chunk', chunk);
        }
    });

    // Parar streaming
    socket.on('stop-stream', () => {
        if (activeStreamers.has(socket.id)) {
            activeStreamers.delete(socket.id);
            socket.leave('streamer');
            console.log(`${socket.id} parou streaming. Streamers ativos: ${activeStreamers.size}`);

            // Notificar listeners
            socket.to('listener').emit('streamer-stopped', {
                streamerId: socket.id,
                timestamp: Date.now()
            });
        }
    });

    // Listener para de ouvir
    socket.on('stop-listening', () => {
        if (activeListeners.has(socket.id)) {
            activeListeners.delete(socket.id);
            socket.leave('listener');
            console.log(`${socket.id} parou de ouvir. Listeners ativos: ${activeListeners.size}`);
        }
    });

    // Obter status do servidor
    socket.on('get-status', () => {
        socket.emit('server-status', {
            streamers: activeStreamers.size,
            listeners: activeListeners.size,
            uptime: process.uptime(),
            timestamp: Date.now(),
            upnpEnabled: upnpEnabled,
            publicIP: publicIP,
            localIP: localIP
        });
    });

    // Cleanup quando usuário desconecta
    socket.on('disconnect', () => {
        console.log('Usuario desconectado:', socket.id);

        // Remover das listas ativas
        if (activeStreamers.has(socket.id)) {
            activeStreamers.delete(socket.id);
            // Notificar listeners se era um streamer
            socket.to('listener').emit('streamer-stopped', {
                streamerId: socket.id,
                reason: 'disconnect',
                timestamp: Date.now()
            });
        }

        if (activeListeners.has(socket.id)) {
            activeListeners.delete(socket.id);
        }

        console.log(`Status após desconexão - Streamers: ${activeStreamers.size}, Listeners: ${activeListeners.size}`);
    });

    // Evento de erro
    socket.on('error', (error) => {
        console.error(`Erro no socket ${socket.id}:`, error);
    });
});

// Endpoint para verificar status via HTTP
app.get('/status', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.json({
        status: 'running',
        streamers: activeStreamers.size,
        listeners: activeListeners.size,
        uptime: process.uptime(),
        timestamp: Date.now(),
        version: '1.0.0',
        upnpEnabled: upnpEnabled,
        publicIP: publicIP,
        localIP: localIP,
        localPort: PORT,
        connectivity: {
            upnp: upnpEnabled,
            publicAccess: publicIP ? `http://${publicIP}:${PORT}` : 'Configure port forwarding',
            localAccess: `http://${localIP}:${PORT}`
        }
    });
});

// Endpoint para testar conectividade
app.get('/test', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.json({
        message: 'Servidor SyncMusic funcionando!',
        timestamp: Date.now(),
        clientIP: req.headers['x-forwarded-for'] || req.connection.remoteAddress
    });
});

// Servir página de teste melhorada
app.get('/', (req, res) => {
    const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const isExternalAccess = clientIP !== localIP && !clientIP.includes('127.0.0.1');

    const connectivityInfo = upnpEnabled
        ? `<p style="color: green;">✅ UPnP ativo - Servidor acessível externamente</p>
           <p><strong>IP Público:</strong> <a href="http://${publicIP}:${PORT}" target="_blank">${publicIP}:${PORT}</a></p>`
        : `<p style="color: orange;">⚠️ UPnP não configurado</p>
           <p><strong>Configure port forwarding:</strong> Porta ${PORT} → ${localIP}:${PORT}</p>
           ${publicIP ? `<p><strong>IP Público:</strong> ${publicIP}:${PORT} (requer configuração manual)</p>` : ''}`;

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>SyncMusic Server</title>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                .status { padding: 10px; border-radius: 5px; margin: 10px 0; }
                .success { background: #d4edda; color: #155724; }
                .warning { background: #fff3cd; color: #856404; }
                .info { background: #d1ecf1; color: #0c5460; }
            </style>
        </head>
        <body>
            <h1>🎵 SyncMusic Server</h1>

            <div class="info status">
                <h3>Status do Servidor</h3>
                <p><strong>Porta:</strong> ${PORT}</p>
                <p><strong>Streamers ativos:</strong> ${activeStreamers.size}</p>
                <p><strong>Listeners ativos:</strong> ${activeListeners.size}</p>
                <p><strong>Uptime:</strong> ${Math.floor(process.uptime())} segundos</p>
                <p><strong>Seu IP:</strong> ${clientIP}</p>
                ${isExternalAccess ? '<p style="color: green;"><strong>✅ Acesso externo detectado!</strong></p>' : ''}
            </div>

            <div class="status">
                <h3>Conectividade</h3>
                ${connectivityInfo}
                <p><strong>IP Local:</strong> <a href="http://${localIP}:${PORT}" target="_blank">${localIP}:${PORT}</a></p>
            </div>

            <div class="status">
                <h3>Como Conectar no Android</h3>
                <ul>
                    <li><strong>Mesma rede:</strong> Use <code>${localIP}</code></li>
                    <li><strong>Internet:</strong> ${upnpEnabled ? `Use <code>${publicIP}</code>` : `Configure port forwarding e use <code>${publicIP || 'SEU_IP_PUBLICO'}</code>`}</li>
                </ul>
            </div>

            <p><a href="/status">📊 Status JSON</a> | <a href="/test">🔧 Teste de Conectividade</a></p>

            <script>
                // Auto-refresh a cada 30 segundos
                setTimeout(() => location.reload(), 30000);
            </script>
        </body>
        </html>
    `);
});

// Configurar servidor para aceitar conexões de qualquer IP
server.listen(PORT, '0.0.0.0', async () => {
    localIP = getLocalIP();

    console.log(`🎵 SyncMusic Server iniciando...`);
    console.log(`🏠 IP Local: ${localIP}:${PORT}`);
    console.log(`🌐 Aceita conexões de qualquer IP`);
    console.log(`🔧 Status: http://localhost:${PORT}/status`);
    console.log(`📱 Interface: http://${localIP}:${PORT}`);

    // Tentar configurar UPnP
    await setupUPnP();

    console.log('');
    console.log('📱 INSTRUÇÕES PARA CONECTAR:');
    console.log('================================');
    if (upnpEnabled) {
        console.log(`✅ UPnP funcionando - Use no Android: ${publicIP}`);
    } else {
        console.log('⚠️  UPnP falhou - Configure manualmente:');
        console.log(`   1. Acesse o painel do seu router`);
        console.log(`   2. Configure port forwarding:`);
        console.log(`      Porta externa: ${PORT} → IP interno: ${localIP}:${PORT}`);
        console.log(`   3. Use no Android: ${publicIP || 'SEU_IP_PUBLICO'}`);
    }
    console.log(`🏠 Rede local - Use no Android: ${localIP}`);
    console.log('================================');
    console.log('');
    console.log('📱 Servidor pronto para conexões!');
});

// Função para limpar UPnP ao sair
function cleanupUPnP() {
    if (upnpEnabled) {
        console.log('🧹 Limpando configuração UPnP...');
        client.portUnmapping({
            public: PORT,
            protocol: 'tcp'
        }, (err) => {
            if (err) {
                console.log('⚠️  Erro ao limpar UPnP:', err.message);
            } else {
                console.log('✅ UPnP limpo com sucesso');
            }
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
}

// Tratamento de sinais para cleanup
process.on('SIGINT', () => {
    console.log('\n🛑 Recebido SIGINT, finalizando servidor...');
    cleanupUPnP();
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Recebido SIGTERM, finalizando servidor...');
    cleanupUPnP();
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
    console.error('Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Promise rejeitada não tratada:', reason);
});
