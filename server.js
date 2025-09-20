// === CHARGEMENT DES COMMANDES ===

const COMMANDS = new Map();

// === CONTEXTE DES COMMANDES AVEC SUPPORT DB, CLANS ET EXPÉRIENCE ===
const commandContext = {
    // Variables globales
    VERIFY_TOKEN,
    PAGE_ACCESS_TOKEN,
    MISTRAL_API_KEY,
    GITHUB_TOKEN,
    GITHUB_USERNAME,
    GITHUB_REPO,
    ADMIN_IDS,
    userMemory,
    userList,
    userLastImage,
    
    // ✅ AJOUT: Base de données SQLite
    db,
    DB_PATH,
    
    // ✅ AJOUT: Données persistantes pour les commandes
    clanData: null, // Sera initialisé par les commandes
    commandData: clanData, // Map pour autres données de commandes
    
    // 🆕 AJOUT: Gestion des messages tronqués
    truncatedMessages,
    
    // Fonctions utilitaires
    log,
    sleep,
    getRandomInt,
    callMistralAPI,
    analyzeImageWithVision,
    webSearch,
    addToMemory,
    getMemoryContext,
    isAdmin,
    sendMessage,
    sendImageMessage,
    
    // 🆕 AJOUT: Fonctions de gestion de troncature + DB
    splitMessageIntoChunks,
    isContinuationRequest,
    saveTruncatedMessageToDB,
    removeTruncatedMessageFromDB,
    
    // Fonctions de sauvegarde DB
    saveUserToDB,
    saveConversationToDB,
    saveUserImageToDB,
    saveUserExpToDB,
    
    // Fonctions de sauvegarde GitHub
    saveDataToGitHub,
    saveDataImmediate,
    loadDataFromGitHub,
    createGitHubRepo
};

// ✅ FONCTION loadCommands MODIFIÉE pour capturer la commande rank
function loadCommands() {
    const commandsDir = path.join(__dirname, 'Cmds');
    
    if (!fs.existsSync(commandsDir)) {
        log.error("❌ Dossier 'Cmds' introuvable");
        return;
    }
    
    const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.js'));
    
    log.info(`🔍 Chargement de ${commandFiles.length} commandes...`);
    
    for (const file of commandFiles) {
        try {
            const commandPath = path.join(commandsDir, file);
            const commandName = path.basename(file, '.js');
            
            delete require.cache[require.resolve(commandPath)];
            
            const commandModule = require(commandPath);
            
            if (typeof commandModule !== 'function') {
                log.error(`❌ ${file} doit exporter une fonction`);
                continue;
            }
            
            COMMANDS.set(commandName, commandModule);
            
            // ✅ NOUVEAU: Capturer la commande rank pour l'expérience
            if (commandName === 'rank') {
                rankCommand = commandModule;
                log.info(`🎯 Système d'expérience activé avec la commande rank`);
            }
            
            log.info(`✅ Commande '${commandName}' chargée`);
            
        } catch (error) {
            log.error(`❌ Erreur chargement ${file}: ${error.message}`);
        }
    }
    
    log.info(`🎉 ${COMMANDS.size} commandes chargées avec succès !`);
}

async function processCommand(senderId, messageText) {
    const senderIdStr = String(senderId);
    
    if (!messageText || typeof messageText !== 'string') {
        return "🤖 Oh là là ! Message vide ! Tape /start ou /help pour commencer notre belle conversation ! 💕";
    }
    
    messageText = messageText.trim();
    
    // 🆕 GESTION DES DEMANDES DE CONTINUATION EN PRIORITÉ
    if (isContinuationRequest(messageText)) {
        const truncatedData = truncatedMessages.get(senderIdStr);
        if (truncatedData) {
            const { fullMessage, lastSentPart } = truncatedData;
            
            // Trouver où on s'était arrêté
            const lastSentIndex = fullMessage.indexOf(lastSentPart) + lastSentPart.length;
            const remainingMessage = fullMessage.substring(lastSentIndex);
            
            if (remainingMessage.trim()) {
                const chunks = splitMessageIntoChunks(remainingMessage, 2000);
                const nextChunk = chunks[0];
                
                // Mettre à jour le cache avec la nouvelle partie envoyée
                if (chunks.length > 1) {
                    truncatedMessages.set(senderIdStr, {
                        fullMessage: fullMessage,
                        lastSentPart: lastSentPart + nextChunk
                    });
                    
                    // Sauvegarder en DB
                    try {
                        await saveTruncatedMessageToDB(senderIdStr, fullMessage, lastSentPart + nextChunk);
                    } catch (error) {
                        log.debug(`🔄 Erreur sauvegarde message tronqué DB: ${error.message}`);
                    }
                    
                    // Ajouter un indicateur de continuation
                    const continuationMsg = nextChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                    addToMemory(senderIdStr, 'user', messageText);
                    addToMemory(senderIdStr, 'assistant', continuationMsg);
                    saveDataImmediate(); // Sauvegarder l'état
                    return continuationMsg;
                } else {
                    // Message terminé
                    truncatedMessages.delete(senderIdStr);
                    try {
                        await removeTruncatedMessageFromDB(senderIdStr);
                    } catch (error) {
                        log.debug(`🔄 Erreur suppression message tronqué DB: ${error.message}`);
                    }
                    
                    addToMemory(senderIdStr, 'user', messageText);
                    addToMemory(senderIdStr, 'assistant', nextChunk);
                    saveDataImmediate(); // Sauvegarder l'état
                    return nextChunk;
                }
            } else {
                // Plus rien à envoyer
                truncatedMessages.delete(senderIdStr);
                try {
                    await removeTruncatedMessageFromDB(senderIdStr);
                } catch (error) {
                    log.debug(`🔄 Erreur suppression message tronqué DB: ${error.message}`);
                }
                
                const endMsg = "✅ C'est tout ! Y a-t-il autre chose que je puisse faire pour toi ? 💫";
                addToMemory(senderIdStr, 'user', messageText);
                addToMemory(senderIdStr, 'assistant', endMsg);
                saveDataImmediate(); // Sauvegarder l'état
                return endMsg;
            }
        } else {
            // Pas de message tronqué en cours
            const noTruncMsg = "🤔 Il n'y a pas de message en cours à continuer. Pose-moi une nouvelle question ! 💡";
            addToMemory(senderIdStr, 'user', messageText);
            addToMemory(senderIdStr, 'assistant', noTruncMsg);
            return noTruncMsg;
        }
    }
    
    if (!messageText.startsWith('/')) {
        if (COMMANDS.has('chat')) {
            return await COMMANDS.get('chat')(senderId, messageText, commandContext);
        }
        return "🤖 Coucou ! Tape /start ou /help pour découvrir ce que je peux faire ! ✨";
    }
    
    const parts = messageText.substring(1).split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');
    
    if (COMMANDS.has(command)) {
        try {
            return await COMMANDS.get(command)(senderId, args, commandContext);
        } catch (error) {
            log.error(`❌ Erreur commande ${command}: ${error.message}`);
            return `💥 Oh non ! Petite erreur dans /${command} ! Réessaie ou tape /help ! 💕`;
        }
    }
    
    return `❓ Oh ! La commande /${command} m'est inconnue ! Tape /help pour voir tout ce que je sais faire ! ✨💕`;
}

// === ROUTES EXPRESS ===

// === ROUTE D'ACCUEIL MISE À JOUR ===
app.get('/', (req, res) => {
    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
    
    res.json({
        status: "🤖 NakamaBot v4.1 DB + GitHub + Clans + Rank + Truncation Online ! 💖",
        creator: "Durand",
        personality: "Super gentille et amicale, comme une très bonne amie",
        year: "2025",
        commands: COMMANDS.size,
        users: userList.size,
        conversations: userMemory.size,
        images_stored: userLastImage.size,
        clans_total: clanCount,
        users_with_exp: expDataCount,
        truncated_messages: truncatedMessages.size,
        version: "4.1 DB + GitHub + Clans + Rank + Truncation",
        storage: {
            primary: "SQLite Database",
            backup: "GitHub API",
            database_path: DB_PATH,
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            persistent: true,
            auto_save: "Every 5 minutes",
            includes: ["users", "conversations", "images", "clans", "command_data", "user_exp", "truncated_messages"]
        },
        features: [
            "Génération d'images IA",
            "Transformation anime", 
            "Analyse d'images IA",
            "Chat intelligent et doux",
            "Base de données SQLite persistante",
            "Sauvegarde GitHub automatique",
            "Système de clans persistant",
            "Système de ranking et expérience",
            "Cartes de rang personnalisées",
            "Gestion intelligente des messages longs",
            "Continuation automatique des réponses",
            "Broadcast admin",
            "Recherche 2025",
            "Stats réservées admin"
        ],
        last_update: new Date().toISOString()
    });
});

// Webhook Facebook Messenger
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        log.info('✅ Webhook vérifié');
        res.status(200).send(challenge);
    } else {
        log.warning('❌ Échec vérification webhook');
        res.status(403).send('Verification failed');
    }
});

// ✅ WEBHOOK PRINCIPAL MODIFIÉ - AJOUT D'EXPÉRIENCE ET NOTIFICATIONS DE NIVEAU + DB
app.post('/webhook', async (req, res) => {
    try {
        const data = req.body;
        
        if (!data) {
            log.warning('⚠️ Aucune donnée reçue');
            return res.status(400).json({ error: "No data received" });
        }
        
        for (const entry of data.entry || []) {
            for (const event of entry.messaging || []) {
                const senderId = event.sender?.id;
                
                if (!senderId) {
                    continue;
                }
                
                const senderIdStr = String(senderId);
                
                if (event.message && !event.message.is_echo) {
                    const wasNewUser = !userList.has(senderIdStr);
                    userList.add(senderIdStr);
                    
                    // ✅ NOUVEAU: Sauvegarder l'utilisateur en DB
                    try {
                        await saveUserToDB(senderIdStr);
                    } catch (error) {
                        log.debug(`🔄 Erreur sauvegarde utilisateur DB: ${error.message}`);
                    }
                    
                    if (wasNewUser) {
                        log.info(`👋 Nouvel utilisateur: ${senderId}`);
                        saveDataImmediate();
                    }
                    
                    if (event.message.attachments) {
                        for (const attachment of event.message.attachments) {
                            if (attachment.type === 'image') {
                                const imageUrl = attachment.payload?.url;
                                if (imageUrl) {
                                    userLastImage.set(senderIdStr, imageUrl);
                                    
                                    // ✅ NOUVEAU: Sauvegarder l'image en DB
                                    try {
                                        await saveUserImageToDB(senderIdStr, imageUrl);
                                    } catch (error) {
                                        log.debug(`🔄 Erreur sauvegarde image DB: ${error.message}`);
                                    }
                                    
                                    log.info(`📸 Image reçue de ${senderId}`);
                                    
                                    addToMemory(senderId, 'user', '[Image envoyée]');
                                    
                                    // ✅ NOUVEAU: Ajouter de l'expérience pour l'envoi d'image
                                    if (rankCommand) {
                                        const expResult = rankCommand.addExp(senderId, 2); // 2 XP pour une image
                                        
                                        if (expResult.levelUp) {
                                            log.info(`🎉 ${senderId} a atteint le niveau ${expResult.newLevel} (image) !`);
                                            
                                            // Sauvegarder l'expérience en DB
                                            try {
                                                await saveUserExpToDB(senderIdStr, expResult.newExp, expResult.newLevel);
                                            } catch (error) {
                                                log.debug(`🔄 Erreur sauvegarde exp DB: ${error.message}`);
                                            }
                                        }
                                    }
                                    
                                    saveDataImmediate();
                                    
                                    const response = "📸 Super ! J'ai bien reçu ton image ! ✨\n\n🎭 Tape /anime pour la transformer en style anime !\n👁️ Tape /vision pour que je te dise ce que je vois !\n\n💕 Ou continue à me parler normalement !";
                                    
                                    const sendResult = await sendMessage(senderId, response);
                                    if (sendResult.success) {
                                        addToMemory(senderId, 'assistant', response);
                                    }
                                    continue;
                                }
                            }
                        }
                    }
                    
                    const messageText = event.message.text?.trim();
                    
                    if (messageText) {
                        log.info(`📨 Message de ${senderId}: ${messageText.substring(0, 50)}...`);
                        
                        // ✅ NOUVEAU: Ajouter de l'expérience pour chaque message
                        if (messageText && rankCommand) {
                            const expResult = rankCommand.addExp(senderId, 1);
                            
                            // Notifier si l'utilisateur a monté de niveau
                            if (expResult.levelUp) {
                                log.info(`🎉 ${senderId} a atteint le niveau ${expResult.newLevel} !`);
                                
                                // Sauvegarder l'expérience en DB
                                try {
                                    await saveUserExpToDB(senderIdStr, expResult.newExp, expResult.newLevel);
                                } catch (error) {
                                    log.debug(`🔄 Erreur sauvegarde exp DB: ${error.message}`);
                                }
                            }
                            
                            // Sauvegarder les données mises à jour
                            saveDataImmediate();
                        }
                        
                        const response = await processCommand(senderId, messageText);
                        
                        if (response) {
                            if (typeof response === 'object' && response.type === 'image') {
                                const sendResult = await sendImageMessage(senderId, response.url, response.caption);
                                
                                if (sendResult.success) {
                                    log.info(`✅ Image envoyée à ${senderId}`);
                                } else {
                                    log.warning(`❌ Échec envoi image à ${senderId}`);
                                    const fallbackMsg = "🎨 Image créée avec amour mais petite erreur d'envoi ! Réessaie ! 💕";
                                    const fallbackResult = await sendMessage(senderId, fallbackMsg);
                                    if (fallbackResult.success) {
                                        addToMemory(senderId, 'assistant', fallbackMsg);
                                    }
                                }
                            } else if (typeof response === 'string') {
                                const sendResult = await sendMessage(senderId, response);
                                
                                if (sendResult.success) {
                                    log.info(`✅ Réponse envoyée à ${senderId}`);
                                } else {
                                    log.warning(`❌ Échec envoi à ${senderId}`);
                                }
                            }
                        }
                    }
                }
            }
        }
    } catch (error) {
        log.error(`❌ Erreur webhook: ${error.message}`);
        return res.status(500).json({ error: `Webhook error: ${error.message}` });
    }
    
    res.status(200).json({ status: "ok" });
});

// Route pour créer un nouveau repository GitHub
app.post('/create-repo', async (req, res) => {
    try {
        if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
            return res.status(400).json({
                success: false,
                error: "GITHUB_TOKEN ou GITHUB_USERNAME manquant"
            });
        }

        const repoCreated = await createGitHubRepo();
        
        if (repoCreated) {
            res.json({
                success: true,
                message: "Repository GitHub créé avec succès !",
                repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
                url: `https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`,
                instructions: [
                    "Le repository a été créé automatiquement",
                    "Les données seront sauvegardées automatiquement",
                    "Vérifiez que le repository est privé pour la sécurité"
                ],
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(500).json({
                success: false,
                error: "Impossible de créer le repository"
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Route pour tester la connexion GitHub
app.get('/test-github', async (req, res) => {
    try {
        if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
            return res.status(400).json({
                success: false,
                error: "Configuration GitHub manquante",
                missing: {
                    token: !GITHUB_TOKEN,
                    username: !GITHUB_USERNAME
                }
            });
        }

        const repoUrl = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}`;
        const response = await axios.get(repoUrl, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            timeout: 10000
        });

        res.json({
            success: true,
            message: "Connexion GitHub OK !",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            url: `https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`,
            status: response.status,
            private: response.data.private,
            created_at: response.data.created_at,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        let errorMessage = error.message;
        let suggestions = [];

        if (error.response?.status === 404) {
            errorMessage = "Repository introuvable (404)";
            suggestions = [
                "Vérifiez que GITHUB_USERNAME et GITHUB_REPO sont corrects",
                "Utilisez POST /create-repo pour créer automatiquement le repository"
            ];
        } else if (error.response?.status === 401) {
            errorMessage = "Token GitHub invalide (401)";
            suggestions = ["Vérifiez votre GITHUB_TOKEN"];
        } else if (error.response?.status === 403) {
            errorMessage = "Accès refusé (403)";
            suggestions = ["Vérifiez les permissions de votre token (repo, contents)"];
        }

        res.status(error.response?.status || 500).json({
            success: false,
            error: errorMessage,
            suggestions: suggestions,
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString()
        });
    }
});

// Route pour forcer une sauvegarde
app.post('/force-save', async (req, res) => {
    try {
        await saveDataToGitHub();
        const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
        const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
        
        res.json({
            success: true,
            message: "Données sauvegardées avec succès sur GitHub !",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString(),
            stats: {
                users: userList.size,
                conversations: userMemory.size,
                images: userLastImage.size,
                clans: clanCount,
                users_with_exp: expDataCount,
                truncated_messages: truncatedMessages.size
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Route pour recharger les données depuis GitHub
app.post('/reload-data', async (req, res) => {
    try {
        await loadDataFromGitHub();
        const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
        const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
        
        res.json({
            success: true,
            message: "Données rechargées avec succès depuis GitHub !",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString(),
            stats: {
                users: userList.size,
                conversations: userMemory.size,
                images: userLastImage.size,
                clans: clanCount,
                users_with_exp: expDataCount,
                truncated_messages: truncatedMessages.size
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Nouvelle route pour voir les statistiques de la base de données
app.get('/db-stats', async (req, res) => {
    try {
        if (!db) {
            return res.status(500).json({
                success: false,
                error: "Base de données non initialisée"
            });
        }
        
        const stats = {};
        
        // Compter les utilisateurs
        await new Promise((resolve, reject) => {
            db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
                if (err) reject(err);
                else {
                    stats.users_in_db = row.count;
                    resolve();
                }
            });
        });
        
        // Compter les conversations
        await new Promise((resolve, reject) => {
            db.get("SELECT COUNT(*) as count FROM conversations", [], (err, row) => {
                if (err) reject(err);
                else {
                    stats.conversations_in_db = row.count;
                    resolve();
                }
            });
        });
        
        // Compter les images
        await new Promise((resolve, reject) => {
            db.get("SELECT COUNT(*) as count FROM user_images", [], (err, row) => {
                if (err) reject(err);
                else {
                    stats.images_in_db = row.count;
                    resolve();
                }
            });
        });
        
        // Compter l'expérience
        await new Promise((resolve, reject) => {
            db.get("SELECT COUNT(*) as count FROM user_experience", [], (err, row) => {
                if (err) reject(err);
                else {
                    stats.exp_records_in_db = row.count;
                    resolve();
                }
            });
        });
        
        // Compter les messages tronqués
        await new Promise((resolve, reject) => {
            db.get("SELECT COUNT(*) as count FROM truncated_messages", [], (err, row) => {
                if (err) reject(err);
                else {
                    stats.truncated_messages_in_db = row.count;
                    resolve();
                }
            });
        });
        
        res.json({
            success: true,
            database_path: DB_PATH,
            database_exists: fs.existsSync(DB_PATH),
            stats: stats,
            memory_stats: {
                users_in_memory: userList.size,
                conversations_in_memory: userMemory.size,
                images_in_memory: userLastImage.size,
                truncated_messages_in_memory: truncatedMessages.size
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// === STATISTIQUES PUBLIQUES MISES À JOUR AVEC DB ET EXPÉRIENCE ===
app.get('/stats', (req, res) => {
    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
    
    res.json({
        users_count: userList.size,
        conversations_count: userMemory.size,
        images_stored: userLastImage.size,
        clans_total: clanCount,
        users_with_exp: expDataCount,
        truncated_messages: truncatedMessages.size,
        commands_available: COMMANDS.size,
        version: "4.1 DB + GitHub + Clans + Rank + Truncation",
        creator: "Durand",
        personality: "Super gentille et amicale, comme une très bonne amie",
        year: 2025,
        storage: {
            primary: "SQLite Database",
            backup: "GitHub API",
            database_path: DB_PATH,
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            persistent: true,
            auto_save_interval: "5 minutes",
            data_types: ["users", "conversations", "images", "clans", "command_data", "user_exp", "truncated_messages"]
        },
        features: [
            "AI Image Generation",
            "Anime Transformation", 
            "AI Image Analysis",
            "Friendly Chat",
            "SQLite Persistent Database",
            "GitHub Backup Storage",
            "Persistent Clan System",
            "User Ranking System",
            "Experience & Levels",
            "Smart Message Truncation",
            "Message Continuation",
            "Admin Stats",
            "Help Suggestions"
        ],
        note: "Statistiques détaillées réservées aux admins via /stats"
    });
});

// === SANTÉ DU BOT MISE À JOUR AVEC DB ET EXPÉRIENCE ===
app.get('/health', (req, res) => {
    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
    
    const healthStatus = {
        status: "healthy",
        personality: "Super gentille et amicale, comme une très bonne amie",
        services: {
            ai: Boolean(MISTRAL_API_KEY),
            vision: Boolean(MISTRAL_API_KEY),
            facebook: Boolean(PAGE_ACCESS_TOKEN),
            database: Boolean(db && fs.existsSync(DB_PATH)),
            github_storage: Boolean(GITHUB_TOKEN && GITHUB_USERNAME),
            ranking_system: Boolean(rankCommand),
            message_truncation: true
        },
        data: {
            users: userList.size,
            conversations: userMemory.size,
            images_stored: userLastImage.size,
            clans_total: clanCount,
            users_with_exp: expDataCount,
            truncated_messages: truncatedMessages.size,
            commands_loaded: COMMANDS.size
        },
        version: "4.1 DB + GitHub + Clans + Rank + Truncation",
        creator: "Durand",
        database_path: DB_PATH,
        repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
        timestamp: new Date().toISOString()
    };
    
    const issues = [];
    if (!MISTRAL_API_KEY) {
        issues.push("Clé IA manquante");
    }
    if (!PAGE_ACCESS_TOKEN) {
        issues.push("Token Facebook manquant");
    }
    if (!db || !fs.existsSync(DB_PATH)) {
        issues.push("Base de données non accessible");
    }
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        issues.push("Configuration GitHub manquante");
    }
    if (COMMANDS.size === 0) {
        issues.push("Aucune commande chargée");
    }
    if (!rankCommand) {
        issues.push("Système de ranking non chargé");
    }
    
    if (issues.length > 0) {
        healthStatus.status = "degraded";
        healthStatus.issues = issues;
    }
    
    const statusCode = healthStatus.status === "healthy" ? 200 : 503;
    res.status(statusCode).json(healthStatus);
});

// === SERVEUR DE FICHIERS STATIQUES POUR LES IMAGES TEMPORAIRES ===

app.use('/temp', express.static(path.join(__dirname, 'temp')));

// Middleware pour nettoyer automatiquement les anciens fichiers temporaires
app.use('/temp', (req, res, next) => {
    // Nettoyer les fichiers de plus de 1 heure
    const tempDir = path.join(__dirname, 'temp');
    if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        const now = Date.now();
        
        files.forEach(file => {
            const filePath = path.join(tempDir, file);
            const stats = fs.statSync(filePath);
            const ageInMs = now - stats.mtime.getTime();
            
            // Supprimer si plus d'1 heure (3600000 ms)
            if (ageInMs > 3600000) {
                try {
                    fs.unlinkSync(filePath);
                    log.debug(`🗑️ Fichier temporaire nettoyé: ${file}`);
                } catch (error) {
                    // Nettoyage silencieux
                }
            }
        });
    }
    next();
});

// Route pour voir l'historique des commits GitHub
app.get('/github-history', async (req, res) => {
    try {
        if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
            return res.status(400).json({
                success: false,
                error: "Configuration GitHub manquante"
            });
        }

        const commitsUrl = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/commits`;
        const response = await axios.get(commitsUrl, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            params: {
                per_page: 10
            },
            timeout: 10000
        });

        const commits = response.data.map(commit => ({
            message: commit.commit.message,
            date: commit.commit.author.date,
            sha: commit.sha.substring(0, 7),
            author: commit.commit.author.name
        }));

        res.json({
            success: true,
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            commits: commits,
            total_shown: commits.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        res.status(error.response?.status || 500).json({
            success: false,
            error: error.message,
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`
        });
    }
});

// Nouvelle route: Nettoyer les messages tronqués (admin uniquement)
app.post('/clear-truncated', async (req, res) => {
    try {
        const clearedCount = truncatedMessages.size;
        truncatedMessages.clear();
        
        // Nettoyer aussi en DB
        if (db) {
            await new Promise((resolve, reject) => {
                db.run("DELETE FROM truncated_messages", [], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
        
        // Sauvegarder immédiatement
        saveDataImmediate();
        
        res.json({
            success: true,
            message: `${clearedCount} conversations tronquées nettoyées`,
            cleared_from_memory: clearedCount,
            cleared_from_db: true,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// === DÉMARRAGE MODIFIÉ AVEC SYSTÈME DB + EXPÉRIENCE ET TRONCATURE ===

const PORT = process.env.PORT || 5000;

async function startBot() {
    log.info("🚀 Démarrage NakamaBot v4.1 DB + GitHub + Clans + Rank + Truncation");
    log.info("💖 Personnalité super gentille et amicale, comme une très bonne amie");
    log.info("👨‍💻 Créée par Durand");
    log.info("📅 Année: 2025");

    // ✅ ÉTAPE 1: Initialiser la base de données
    log.info("🗄️ Initialisation de la base de données SQLite...");
    try {
        await initializeDatabase();
        commandContext.db = db; // Mettre à jour le contexte
    } catch (error) {
        log.error(`❌ Erreur initialisation DB: ${error.message}`);
        process.exit(1);
    }

    // ✅ ÉTAPE 2: Charger les données depuis la DB
    log.info("📥 Chargement des données depuis la base de données...");
    try {
        await loadDataFromDB();
    } catch (error) {
        log.error(`❌ Erreur chargement DB: ${error.message}`);
    }

    // ✅ ÉTAPE 3: Essayer de charger depuis GitHub (sauvegarde)
    log.info("📥 Tentative de chargement depuis GitHub...");
    await loadDataFromGitHub();

    // ✅ ÉTAPE 4: Charger les commandes
    loadCommands();

    // ✅ ÉTAPE 5: Charger les données d'expérience après le chargement des commandes
    if (rankCommand) {
        log.info("🎯 Système d'expérience détecté et prêt !");
    } else {
        log.warning("⚠️ Commande rank non trouvée - Système d'expérience désactivé");
    }

    const missingVars = [];
    if (!PAGE_ACCESS_TOKEN) {
        missingVars.push("PAGE_ACCESS_TOKEN");
    }
    if (!MISTRAL_API_KEY) {
        missingVars.push("MISTRAL_API_KEY");
    }
    if (!GITHUB_TOKEN) {
        missingVars.push("GITHUB_TOKEN");
    }
    if (!GITHUB_USERNAME) {
        missingVars.push("GITHUB_USERNAME");
    }

    if (missingVars.length > 0) {
        log.error(`❌ Variables manquantes: ${missingVars.join(', ')}`);
    } else {
        log.info("✅ Configuration complète OK");
    }

    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;

    log.info(`🎨 ${COMMANDS.size} commandes disponibles`);
    log.info(`👥 ${userList.size} utilisateurs en mémoire`);
    log.info(`💬 ${userMemory.size} conversations en mémoire`);
    log.info(`🖼️ ${userLastImage.size} images en mémoire`);
    log.info(`🏰 ${clanCount} clans en mémoire`);
    log.info(`⭐ ${expDataCount} utilisateurs avec expérience`);
    log.info(`📝 ${truncatedMessages.size} conversations tronquées en cours`);
    log.info(`🔐 ${ADMIN_IDS.size} administrateurs`);
    log.info(`🗄️ Base de données: ${DB_PATH}`);
    log.info(`📂 Repository: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
    log.info(`🌐 Serveur sur le port ${PORT}`);
    
    startAutoSave();
    
    log.info("🎉 NakamaBot DB + GitHub + Clans + Rank + Truncation prête à aider avec gentillesse !");

    app.listen(PORT, () => {
        log.info(`🌐 Serveur démarré sur le port ${PORT}`);
        log.info("🗄️ Base de données SQLite active");
        log.info("💾 Sauvegarde automatique GitHub activée");
        log.info("📏 Gestion intelligente des messages longs activée");
        log.info(`📊 Dashboard: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`);
    });
}

// Fonction de nettoyage lors de l'arrêt
async function gracefulShutdown() {
    log.info("🛑 Arrêt du bot avec tendresse...");
    
    if (saveInterval) {
        clearInterval(saveInterval);
        log.info("⏹️ Sauvegarde automatique arrêtée");
    }
    
    try {
        log.info("💾 Sauvegarde finale des données sur GitHub...");
        await saveDataToGitHub();
        log.info("✅ Données sauvegardées avec succès !");
    } catch (error) {
        log.error(`❌ Erreur sauvegarde finale: ${error.message}`);
    }
    
    // Fermer la base de données
    if (db) {
        try {
            await new Promise((resolve, reject) => {
                db.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            log.info("🗄️ Base de données fermée proprement");
        } catch (error) {
            log.error(`❌ Erreur fermeture DB: ${error.message}`);
        }
    }
    
    // Nettoyage final des messages tronqués
    const truncatedCount = truncatedMessages.size;
    if (truncatedCount > 0) {
        log.info(`🧹 Nettoyage de ${truncatedCount} conversations tronquées en cours...`);
        truncatedMessages.clear();
    }
    
    log.info("👋 Au revoir ! Données sauvegardées en DB et sur GitHub !");
    log.info(`🗄️ Base de données: ${DB_PATH}`);
    log.info(`📂 Repository: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`);
    process.exit(0);
}

// Gestion propre de l'arrêt
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Gestion des erreurs non capturées
process.on('uncaughtException', async (error) => {
    log.error(`❌ Erreur non capturée: ${error.message}`);
    await gracefulShutdown();
});

process.on('unhandledRejection', async (reason, promise) => {
    log.error(`❌ Promesse rejetée: ${reason}`);
    await gracefulShutdown();
});

// Nettoyage périodique: Nettoyer les messages tronqués anciens (plus de 24h)
setInterval(async () => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000; // 24 heures en millisecondes
    let cleanedCount = 0;
    
    for (const [userId, data] of truncatedMessages.entries()) {
        // Si le message n'a pas de timestamp ou est trop ancien
        if (!data.timestamp || (now - new Date(data.timestamp).getTime() > oneDayMs)) {
            truncatedMessages.delete(userId);
            
            // Supprimer aussi de la DB
            try {
                await removeTruncatedMessageFromDB(userId);
            } catch (error) {
                log.debug(`🔄 Erreur suppression message tronqué DB: ${error.message}`);
            }
            
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        log.info(`🧹 Nettoyage automatique: ${cleanedCount} conversations tronquées expirées supprimées`);
        saveDataImmediate(); // Sauvegarder le nettoyage
    }
}, 60 * 60 * 1000); // Vérifier toutes les heures

// Démarrer le bot
startBot().catch(error => {
    log.error(`❌ Erreur démarrage: ${error.message}`);
    process.exit(1);
});const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(bodyParser.json());

// Configuration 
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "nakamaverifytoken";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || "";
const GITHUB_REPO = process.env.GITHUB_REPO || "nakamabot-data";
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT || 5000}`;
const DB_PATH = path.join(__dirname, 'nakamabot.db');
const ADMIN_IDS = new Set(
    (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(id => id)
);

// Mémoire du bot (stockage local temporaire + sauvegarde permanente DB + GitHub)
const userMemory = new Map();
const userList = new Set();
const userLastImage = new Map();
const clanData = new Map(); // Stockage des données spécifiques aux commandes

// ✅ NOUVEAU: Référence vers la commande rank pour le système d'expérience
let rankCommand = null;

// 🆕 AJOUT: Gestion des messages tronqués avec chunks
const truncatedMessages = new Map(); // senderId -> { fullMessage, lastSentPart }

// Base de données SQLite
let db = null;

// Configuration des logs
const log = {
    info: (msg) => console.log(`${new Date().toISOString()} - INFO - ${msg}`),
    error: (msg) => console.error(`${new Date().toISOString()} - ERROR - ${msg}`),
    warning: (msg) => console.warn(`${new Date().toISOString()} - WARNING - ${msg}`),
    debug: (msg) => console.log(`${new Date().toISOString()} - DEBUG - ${msg}`)
};

// === GESTION BASE DE DONNÉES SQLite ===

function initializeDatabase() {
    return new Promise((resolve, reject) => {
        // Créer le fichier DB s'il n'existe pas
        if (!fs.existsSync(DB_PATH)) {
            log.info(`🗄️ Création de la base de données: ${DB_PATH}`);
        } else {
            log.info(`🗄️ Base de données trouvée: ${DB_PATH}`);
        }
        
        db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                log.error(`❌ Erreur ouverture DB: ${err.message}`);
                reject(err);
                return;
            }
            
            // Créer les tables si elles n'existent pas
            const createTables = `
                CREATE TABLE IF NOT EXISTS users (
                    user_id TEXT PRIMARY KEY,
                    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                    message_count INTEGER DEFAULT 0
                );
                
                CREATE TABLE IF NOT EXISTS conversations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT,
                    message_type TEXT,
                    content TEXT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (user_id)
                );
                
                CREATE TABLE IF NOT EXISTS user_images (
                    user_id TEXT PRIMARY KEY,
                    image_url TEXT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (user_id)
                );
                
                CREATE TABLE IF NOT EXISTS user_experience (
                    user_id TEXT PRIMARY KEY,
                    exp_points INTEGER DEFAULT 0,
                    level INTEGER DEFAULT 1,
                    last_exp_gain DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (user_id)
                );
                
                CREATE TABLE IF NOT EXISTS clan_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    data_type TEXT,
                    data_key TEXT,
                    data_value TEXT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE TABLE IF NOT EXISTS truncated_messages (
                    user_id TEXT PRIMARY KEY,
                    full_message TEXT,
                    last_sent_part TEXT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE TABLE IF NOT EXISTS command_data (
                    command_name TEXT,
                    data_key TEXT,
                    data_value TEXT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (command_name, data_key)
                );
            `;
            
            db.exec(createTables, (err) => {
                if (err) {
                    log.error(`❌ Erreur création tables: ${err.message}`);
                    reject(err);
                    return;
                }
                
                log.info("✅ Base de données initialisée avec succès");
                resolve();
            });
        });
    });
}

// Sauvegarder un utilisateur dans la DB
function saveUserToDB(userId) {
    return new Promise((resolve, reject) => {
        const query = `
            INSERT OR REPLACE INTO users (user_id, last_seen, message_count)
            VALUES (?, CURRENT_TIMESTAMP, 
                COALESCE((SELECT message_count FROM users WHERE user_id = ?), 0) + 1
            )
        `;
        
        db.run(query, [userId, userId], (err) => {
            if (err) {
                log.error(`❌ Erreur sauvegarde utilisateur ${userId}: ${err.message}`);
                reject(err);
                return;
            }
            resolve();
        });
    });
}

// Sauvegarder une conversation dans la DB
function saveConversationToDB(userId, messageType, content) {
    return new Promise((resolve, reject) => {
        // Limiter la taille du contenu
        const limitedContent = content.length > 1500 ? 
            content.substring(0, 1400) + "...[tronqué]" : content;
        
        const query = `
            INSERT INTO conversations (user_id, message_type, content)
            VALUES (?, ?, ?)
        `;
        
        db.run(query, [userId, messageType, limitedContent], (err) => {
            if (err) {
                log.error(`❌ Erreur sauvegarde conversation: ${err.message}`);
                reject(err);
                return;
            }
            resolve();
        });
    });
}

// Sauvegarder une image utilisateur dans la DB
function saveUserImageToDB(userId, imageUrl) {
    return new Promise((resolve, reject) => {
        const query = `
            INSERT OR REPLACE INTO user_images (user_id, image_url, timestamp)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `;
        
        db.run(query, [userId, imageUrl], (err) => {
            if (err) {
                log.error(`❌ Erreur sauvegarde image: ${err.message}`);
                reject(err);
                return;
            }
            resolve();
        });
    });
}

// Sauvegarder l'expérience utilisateur dans la DB
function saveUserExpToDB(userId, expPoints, level) {
    return new Promise((resolve, reject) => {
        const query = `
            INSERT OR REPLACE INTO user_experience (user_id, exp_points, level, last_exp_gain)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `;
        
        db.run(query, [userId, expPoints, level], (err) => {
            if (err) {
                log.error(`❌ Erreur sauvegarde expérience: ${err.message}`);
                reject(err);
                return;
            }
            resolve();
        });
    });
}

// Sauvegarder un message tronqué dans la DB
function saveTruncatedMessageToDB(userId, fullMessage, lastSentPart) {
    return new Promise((resolve, reject) => {
        const query = `
            INSERT OR REPLACE INTO truncated_messages (user_id, full_message, last_sent_part, timestamp)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `;
        
        db.run(query, [userId, fullMessage, lastSentPart], (err) => {
            if (err) {
                log.error(`❌ Erreur sauvegarde message tronqué: ${err.message}`);
                reject(err);
                return;
            }
            resolve();
        });
    });
}

// Supprimer un message tronqué de la DB
function removeTruncatedMessageFromDB(userId) {
    return new Promise((resolve, reject) => {
        const query = `DELETE FROM truncated_messages WHERE user_id = ?`;
        
        db.run(query, [userId], (err) => {
            if (err) {
                log.error(`❌ Erreur suppression message tronqué: ${err.message}`);
                reject(err);
                return;
            }
            resolve();
        });
    });
}

// Charger les données depuis la DB au démarrage
async function loadDataFromDB() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error("Base de données non initialisée"));
            return;
        }
        
        // Charger les utilisateurs
        db.all("SELECT user_id FROM users", [], (err, users) => {
            if (err) {
                log.error(`❌ Erreur chargement utilisateurs: ${err.message}`);
            } else {
                users.forEach(user => userList.add(user.user_id));
                log.info(`📥 ${users.length} utilisateurs chargés depuis la DB`);
            }
            
            // Charger les conversations récentes (dernières 8 par utilisateur)
            const conversationQuery = `
                SELECT user_id, message_type, content, timestamp
                FROM (
                    SELECT user_id, message_type, content, timestamp,
                           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY timestamp DESC) as rn
                    FROM conversations
                ) ranked
                WHERE rn <= 8
                ORDER BY user_id, timestamp
            `;
            
            db.all(conversationQuery, [], (err, conversations) => {
                if (err) {
                    log.error(`❌ Erreur chargement conversations: ${err.message}`);
                } else {
                    conversations.forEach(conv => {
                        if (!userMemory.has(conv.user_id)) {
                            userMemory.set(conv.user_id, []);
                        }
                        userMemory.get(conv.user_id).push({
                            type: conv.message_type,
                            content: conv.content,
                            timestamp: conv.timestamp
                        });
                    });
                    log.info(`💬 Conversations chargées pour ${userMemory.size} utilisateurs depuis la DB`);
                }
                
                // Charger les images utilisateur
                db.all("SELECT user_id, image_url FROM user_images", [], (err, images) => {
                    if (err) {
                        log.error(`❌ Erreur chargement images: ${err.message}`);
                    } else {
                        images.forEach(img => userLastImage.set(img.user_id, img.image_url));
                        log.info(`🖼️ ${images.length} images utilisateur chargées depuis la DB`);
                    }
                    
                    // Charger les messages tronqués
                    db.all("SELECT user_id, full_message, last_sent_part FROM truncated_messages", [], (err, truncated) => {
                        if (err) {
                            log.error(`❌ Erreur chargement messages tronqués: ${err.message}`);
                        } else {
                            truncated.forEach(trunc => {
                                truncatedMessages.set(trunc.user_id, {
                                    fullMessage: trunc.full_message,
                                    lastSentPart: trunc.last_sent_part
                                });
                            });
                            log.info(`📝 ${truncated.length} messages tronqués chargés depuis la DB`);
                        }
                        
                        log.info("✅ Toutes les données chargées depuis la DB");
                        resolve();
                    });
                });
            });
        });
    });
}

// Exporter les données DB vers JSON pour GitHub
async function exportDBToJSON() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error("Base de données non initialisée"));
            return;
        }
        
        const exportData = {
            userList: [],
            userMemory: {},
            userLastImage: {},
            userExp: {},
            truncatedMessages: {},
            clanData: commandContext.clanData || null,
            commandData: {},
            lastUpdate: new Date().toISOString(),
            version: "4.0 DB + GitHub",
            bot: "NakamaBot",
            creator: "Durand"
        };
        
        // Exporter depuis les Maps en mémoire (plus rapide)
        exportData.userList = Array.from(userList);
        exportData.userMemory = Object.fromEntries(userMemory);
        exportData.userLastImage = Object.fromEntries(userLastImage);
        exportData.truncatedMessages = Object.fromEntries(truncatedMessages);
        exportData.commandData = Object.fromEntries(clanData);
        
        // Récupérer les données d'expérience depuis rankCommand si disponible
        if (rankCommand) {
            exportData.userExp = rankCommand.getExpData();
        }
        
        // Calculer les statistiques
        exportData.totalUsers = userList.size;
        exportData.totalConversations = userMemory.size;
        exportData.totalImages = userLastImage.size;
        exportData.totalTruncated = truncatedMessages.size;
        exportData.totalClans = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
        exportData.totalUsersWithExp = Object.keys(exportData.userExp).length;
        
        resolve(exportData);
    });
}

// === FONCTIONS DE GESTION DES MESSAGES TRONQUÉS ===

/**
 * Divise un message en chunks de taille appropriée pour Messenger
 * @param {string} text - Texte complet
 * @param {number} maxLength - Taille maximale par chunk (défaut: 2000)
 * @returns {Array} - Array des chunks
 */
function splitMessageIntoChunks(text, maxLength = 2000) {
    if (!text || text.length <= maxLength) {
        return [text];
    }
    
    const chunks = [];
    let currentChunk = '';
    const lines = text.split('\n');
    
    for (const line of lines) {
        // Si ajouter cette ligne dépasse la limite
        if (currentChunk.length + line.length + 1 > maxLength) {
            // Si le chunk actuel n'est pas vide, le sauvegarder
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
            
            // Si la ligne elle-même est trop longue, la couper
            if (line.length > maxLength) {
                const words = line.split(' ');
                let currentLine = '';
                
                for (const word of words) {
                    if (currentLine.length + word.length + 1 > maxLength) {
                        if (currentLine.trim()) {
                            chunks.push(currentLine.trim());
                            currentLine = word;
                        } else {
                            // Mot unique trop long, le couper brutalement
                            chunks.push(word.substring(0, maxLength - 3) + '...');
                            currentLine = word.substring(maxLength - 3);
                        }
                    } else {
                        currentLine += (currentLine ? ' ' : '') + word;
                    }
                }
                
                if (currentLine.trim()) {
                    currentChunk = currentLine;
                }
            } else {
                currentChunk = line;
            }
        } else {
            currentChunk += (currentChunk ? '\n' : '') + line;
        }
    }
    
    // Ajouter le dernier chunk s'il n'est pas vide
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks.length > 0 ? chunks : [text];
}

/**
 * Détecte si l'utilisateur demande la suite d'un message tronqué
 * @param {string} message - Message de l'utilisateur
 * @returns {boolean} - True si c'est une demande de continuation
 */
function isContinuationRequest(message) {
    const lowerMessage = message.toLowerCase().trim();
    const continuationPatterns = [
        /^(continue|continuer?)$/,
        /^(suite|la suite)$/,
        /^(après|ensuite)$/,
        /^(plus|encore)$/,
        /^(next|suivant)$/,
        /^\.\.\.$/,
        /^(termine|fini[sr]?)$/
    ];
    
    return continuationPatterns.some(pattern => pattern.test(lowerMessage));
}

// === GESTION GITHUB API ===

// Encoder en base64 pour GitHub
function encodeBase64(content) {
    return Buffer.from(JSON.stringify(content, null, 2), 'utf8').toString('base64');
}

// Décoder depuis base64 GitHub
function decodeBase64(content) {
    return JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
}

// URL de base pour l'API GitHub
const getGitHubApiUrl = (filename) => {
    return `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${filename}`;
};

// Créer le repository GitHub si nécessaire
async function createGitHubRepo() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.error("❌ GITHUB_TOKEN ou GITHUB_USERNAME manquant pour créer le repo");
        return false;
    }

    try {
        const checkResponse = await axios.get(
            `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}`,
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                },
                timeout: 10000
            }
        );
        
        if (checkResponse.status === 200) {
            log.info(`✅ Repository ${GITHUB_REPO} existe déjà`);
            return true;
        }
    } catch (error) {
        if (error.response?.status === 404) {
            try {
                const createResponse = await axios.post(
                    'https://api.github.com/user/repos',
                    {
                        name: GITHUB_REPO,
                        description: 'Sauvegarde des données NakamaBot - Créé automatiquement',
                        private: true,
                        auto_init: true
                    },
                    {
                        headers: {
                            'Authorization': `token ${GITHUB_TOKEN}`,
                            'Accept': 'application/vnd.github.v3+json'
                        },
                        timeout: 15000
                    }
                );

                if (createResponse.status === 201) {
                    log.info(`🎉 Repository ${GITHUB_REPO} créé avec succès !`);
                    log.info(`📝 URL: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`);
                    return true;
                }
            } catch (createError) {
                log.error(`❌ Erreur création repository: ${createError.message}`);
                return false;
            }
        } else {
            log.error(`❌ Erreur vérification repository: ${error.message}`);
            return false;
        }
    }

    return false;
}

// Variable pour éviter les sauvegardes simultanées
let isSaving = false;
let saveQueue = [];

// === SAUVEGARDE GITHUB AVEC DB ===
async function saveDataToGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.debug("🔄 Pas de sauvegarde GitHub (config manquante)");
        return;
    }

    if (isSaving) {
        log.debug("⏳ Sauvegarde déjà en cours, ajout à la queue");
        return new Promise((resolve) => {
            saveQueue.push(resolve);
        });
    }

    isSaving = true;

    try {
        log.debug(`💾 Tentative de sauvegarde sur GitHub: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
        
        const filename = 'nakamabot-data.json';
        const url = getGitHubApiUrl(filename);
        
        // Exporter les données depuis la DB
        const dataToSave = await exportDBToJSON();
        
        const commitData = {
            message: `🤖 Sauvegarde automatique NakamaBot (DB+GitHub) - ${new Date().toISOString()}`,
            content: encodeBase64(dataToSave)
        };

        let maxRetries = 3;
        let success = false;

        for (let attempt = 1; attempt <= maxRetries && !success; attempt++) {
            try {
                const existingResponse = await axios.get(url, {
                    headers: {
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json'
                    },
                    timeout: 10000
                });

                if (existingResponse.data?.sha) {
                    commitData.sha = existingResponse.data.sha;
                }

                const response = await axios.put(url, commitData, {
                    headers: {
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'Accept': 'application/vnd.github.v3+json'
                    },
                    timeout: 15000
                });

                if (response.status === 200 || response.status === 201) {
                    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
                    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
                    log.info(`💾 Données DB sauvegardées sur GitHub (${userList.size} users, ${userMemory.size} convs, ${userLastImage.size} imgs, ${clanCount} clans, ${expDataCount} exp, ${truncatedMessages.size} trunc)`);
                    success = true;
                } else {
                    log.error(`❌ Erreur sauvegarde GitHub: ${response.status}`);
                }

            } catch (retryError) {
                if (retryError.response?.status === 409 && attempt < maxRetries) {
                    log.warning(`⚠️ Conflit SHA détecté (409), tentative ${attempt}/${maxRetries}, retry dans 1s...`);
                    await sleep(1000);
                    continue;
                } else if (retryError.response?.status === 404 && attempt === 1) {
                    log.debug("📝 Premier fichier, pas de SHA nécessaire");
                    delete commitData.sha;
                    continue;
                } else {
                    throw retryError;
                }
            }
        }

        if (!success) {
            log.error("❌ Échec de sauvegarde après plusieurs tentatives");
        }

    } catch (error) {
        if (error.response?.status === 404) {
            log.error("❌ Repository GitHub introuvable pour la sauvegarde (404)");
            log.error(`🔍 Repository utilisé: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
        } else if (error.response?.status === 401) {
            log.error("❌ Token GitHub invalide pour la sauvegarde (401)");
        } else if (error.response?.status === 403) {
            log.error("❌ Accès refusé GitHub pour la sauvegarde (403)");
        } else if (error.response?.status === 409) {
            log.warning("⚠️ Conflit SHA persistant - sauvegarde ignorée pour éviter les blocages");
        } else {
            log.error(`❌ Erreur sauvegarde GitHub: ${error.message}`);
        }
    } finally {
        isSaving = false;
        
        const queueCallbacks = [...saveQueue];
        saveQueue = [];
        queueCallbacks.forEach(callback => callback());
    }
}

// === CHARGEMENT GITHUB AVEC DB ===
async function loadDataFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.warning("⚠️ Configuration GitHub manquante, utilisation de la DB uniquement");
        return;
    }

    try {
        log.info(`🔍 Tentative de chargement depuis GitHub: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
        
        const filename = 'nakamabot-data.json';
        const url = getGitHubApiUrl(filename);
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            timeout: 10000
        });

        if (response.status === 200 && response.data.content) {
            const data = decodeBase64(response.data.content);
            
            // Charger userList
            if (data.userList && Array.isArray(data.userList)) {
                data.userList.forEach(userId => userList.add(userId));
                log.info(`✅ ${data.userList.length} utilisateurs chargés depuis GitHub`);
            }

            // Charger userMemory
            if (data.userMemory && typeof data.userMemory === 'object') {
                Object.entries(data.userMemory).forEach(([userId, memory]) => {
                    if (Array.isArray(memory)) {
                        userMemory.set(userId, memory);
                    }
                });
                log.info(`✅ ${Object.keys(data.userMemory).length} conversations chargées depuis GitHub`);
            }

            // Charger userLastImage
            if (data.userLastImage && typeof data.userLastImage === 'object') {
                Object.entries(data.userLastImage).forEach(([userId, imageUrl]) => {
                    userLastImage.set(userId, imageUrl);
                });
                log.info(`✅ ${Object.keys(data.userLastImage).length} images chargées depuis GitHub`);
            }

            // Charger les messages tronqués
            if (data.truncatedMessages && typeof data.truncatedMessages === 'object') {
                Object.entries(data.truncatedMessages).forEach(([userId, truncData]) => {
                    if (truncData && typeof truncData === 'object') {
                        truncatedMessages.set(userId, truncData);
                    }
                });
                log.info(`✅ ${Object.keys(data.truncatedMessages).length} messages tronqués chargés depuis GitHub`);
            }

            // Charger les données d'expérience
            if (data.userExp && typeof data.userExp === 'object' && rankCommand) {
                rankCommand.loadExpData(data.userExp);
                log.info(`✅ ${Object.keys(data.userExp).length} données d'expérience chargées depuis GitHub`);
            }

            // Charger les données des clans
            if (data.clanData && typeof data.clanData === 'object') {
                commandContext.clanData = data.clanData;
                const clanCount = Object.keys(data.clanData.clans || {}).length;
                log.info(`✅ ${clanCount} clans chargés depuis GitHub`);
            }

            // Charger autres données de commandes
            if (data.commandData && typeof data.commandData === 'object') {
                Object.entries(data.commandData).forEach(([key, value]) => {
                    clanData.set(key, value);
                });
                log.info(`✅ ${Object.keys(data.commandData).length} données de commandes chargées depuis GitHub`);
            }

            log.info("🎉 Données chargées avec succès depuis GitHub !");
        }
    } catch (error) {
        if (error.response?.status === 404) {
            log.warning("📁 Aucune sauvegarde trouvée sur GitHub - Utilisation de la DB locale");
        } else if (error.response?.status === 401) {
            log.error("❌ Token GitHub invalide (401) - Vérifiez votre GITHUB_TOKEN");
        } else if (error.response?.status === 403) {
            log.error("❌ Accès refusé GitHub (403) - Vérifiez les permissions de votre token");
        } else {
            log.error(`❌ Erreur chargement GitHub: ${error.message}`);
        }
        
        log.info("🔄 Chargement depuis la base de données locale...");
        await loadDataFromDB();
    }
}

// Sauvegarder automatiquement toutes les 5 minutes
let saveInterval;
function startAutoSave() {
    if (saveInterval) {
        clearInterval(saveInterval);
    }
    
    saveInterval = setInterval(async () => {
        await saveDataToGitHub();
    }, 5 * 60 * 1000); // 5 minutes
    
    log.info("🔄 Sauvegarde automatique GitHub activée (toutes les 5 minutes)");
}

// Sauvegarder lors de changements importants (non-bloquant)
async function saveDataImmediate() {
    saveDataToGitHub().catch(err => 
        log.debug(`🔄 Sauvegarde en arrière-plan: ${err.message}`)
    );
}

// === UTILITAIRES ===

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Appel API Mistral avec retry
async function callMistralAPI(messages, maxTokens = 200, temperature = 0.7) {
    if (!MISTRAL_API_KEY) {
        return null;
    }
    
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MISTRAL_API_KEY}`
    };
    
    const data = {
        model: "mistral-small-latest",
        messages: messages,
        max_tokens: maxTokens,
        temperature: temperature
    };
    
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await axios.post(
                "https://api.mistral.ai/v1/chat/completions",
                data,
                { headers, timeout: 30000 }
            );
            
            if (response.status === 200) {
                return response.data.choices[0].message.content;
            } else if (response.status === 401) {
                log.error("❌ Clé API Mistral invalide");
                return null;
            } else {
                if (attempt === 0) {
                    await sleep(2000);
                    continue;
                }
                return null;
            }
        } catch (error) {
            if (attempt === 0) {
                await sleep(2000);
                continue;
            }
            log.error(`❌ Erreur Mistral: ${error.message}`);
            return null;
        }
    }
    
    return null;
}

// Analyser une image avec l'API Vision de Mistral
async function analyzeImageWithVision(imageUrl) {
    if (!MISTRAL_API_KEY) {
        return null;
    }
    
    try {
        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${MISTRAL_API_KEY}`
        };
        
        const messages = [{
            role: "user",
            content: [
                {
                    type: "text",
                    text: "Décris en détail ce que tu vois dans cette image en français. Sois précise et descriptive, comme si tu expliquais à un(e) ami(e). Maximum 300 mots avec des emojis mignons. 💕"
                },
                {
                    type: "image_url",
                    image_url: {
                        url: imageUrl
                    }
                }
            ]
        }];
        
        const data = {
            model: "pixtral-12b-2409",
            messages: messages,
            max_tokens: 400,
            temperature: 0.3
        };
        
        const response = await axios.post(
            "https://api.mistral.ai/v1/chat/completions",
            data,
            { headers, timeout: 30000 }
        );
        
        if (response.status === 200) {
            return response.data.choices[0].message.content;
        } else {
            log.error(`❌ Erreur Vision API: ${response.status}`);
            return null;
        }
    } catch (error) {
        log.error(`❌ Erreur analyse image: ${error.message}`);
        return null;
    }
}

// Recherche web simulée
async function webSearch(query) {
    try {
        const searchContext = `Recherche web pour '${query}' en 2025. Je peux répondre avec mes connaissances de 2025.`;
        const messages = [{
            role: "system",
            content: `Tu es NakamaBot, une assistante IA très gentille et amicale qui aide avec les recherches. Nous sommes en 2025. Réponds à cette recherche: '${query}' avec tes connaissances de 2025. Si tu ne sais pas, dis-le gentiment. Réponds en français avec une personnalité amicale et bienveillante, maximum 300 caractères.`
        }];
        
        return await callMistralAPI(messages, 150, 0.3);
    } catch (error) {
        log.error(`❌ Erreur recherche: ${error.message}`);
        return "Oh non ! Une petite erreur de recherche... Désolée ! 💕";
    }
}

// ✅ GESTION CORRIGÉE DE LA MÉMOIRE - ÉVITER LES DOUBLONS + DB
async function addToMemory(userId, msgType, content) {
    if (!userId || !msgType || !content) {
        log.debug("❌ Paramètres manquants pour addToMemory");
        return;
    }
    
    const userIdStr = String(userId);
    
    if (content.length > 1500) {
        content = content.substring(0, 1400) + "...[tronqué]";
    }
    
    if (!userMemory.has(userIdStr)) {
        userMemory.set(userIdStr, []);
    }
    
    const memory = userMemory.get(userIdStr);
    
    // ✅ Vérifier les doublons
    if (memory.length > 0) {
        const lastMessage = memory[memory.length - 1];
        
        if (lastMessage.type === msgType && lastMessage.content === content) {
            log.debug(`🔄 Doublon évité pour ${userIdStr}: ${msgType.substring(0, 50)}...`);
            return;
        }
        
        if (msgType === 'assistant' && lastMessage.type === 'assistant') {
            const similarity = calculateSimilarity(lastMessage.content, content);
            if (similarity > 0.8) {
                log.debug(`🔄 Doublon assistant évité (similarité: ${Math.round(similarity * 100)}%)`);
                return;
            }
        }
    }
    
    memory.push({
        type: msgType,
        content: content,
        timestamp: new Date().toISOString()
    });
    
    if (memory.length > 8) {
        memory.shift();
    }
    
    log.debug(`💭 Ajouté en mémoire [${userIdStr}]: ${msgType} (${content.length} chars)`);
    
    // ✅ NOUVEAU: Sauvegarder en DB également
    try {
        await saveConversationToDB(userIdStr, msgType, content);
    } catch (error) {
        log.debug(`🔄 Erreur sauvegarde conversation DB: ${error.message}`);
    }
    
    saveDataImmediate().catch(err => 
        log.debug(`🔄 Erreur sauvegarde mémoire: ${err.message}`)
    );
}

// ✅ FONCTION UTILITAIRE: Calculer la similarité entre deux textes
function calculateSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    const normalize = (text) => text.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const norm1 = normalize(text1);
    const norm2 = normalize(text2);
    
    if (norm1 === norm2) return 1;
    
    const words1 = new Set(norm1.split(/\s+/));
    const words2 = new Set(norm2.split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
}

function getMemoryContext(userId) {
    const context = [];
    const memory = userMemory.get(String(userId)) || [];
    
    for (const msg of memory) {
        const role = msg.type === 'user' ? 'user' : 'assistant';
        context.push({ role, content: msg.content });
    }
    
    return context;
}

function isAdmin(userId) {
    return ADMIN_IDS.has(String(userId));
}

// === FONCTIONS D'ENVOI AVEC GESTION DE TRONCATURE + DB ===

async function sendMessage(recipientId, text) {
    if (!PAGE_ACCESS_TOKEN) {
        log.error("❌ PAGE_ACCESS_TOKEN manquant");
        return { success: false, error: "No token" };
    }
    
    if (!text || typeof text !== 'string') {
        log.warning("⚠️ Message vide");
        return { success: false, error: "Empty message" };
    }
    
    const recipientIdStr = String(recipientId);
    
    // 🆕 GESTION INTELLIGENTE DES MESSAGES LONGS
    if (text.length > 6000) {
        log.info(`📏 Message long détecté (${text.length} chars) pour ${recipientIdStr} - Division en chunks`);
        
        const chunks = splitMessageIntoChunks(text, 2000);
        
        if (chunks.length > 1) {
            // Envoyer le premier chunk avec indicateur de continuation
            const firstChunk = chunks[0] + "\n\n📝 *Tape \"continue\" pour la suite...*";
            
            // Sauvegarder l'état de troncature en mémoire
            truncatedMessages.set(recipientIdStr, {
                fullMessage: text,
                lastSentPart: chunks[0]
            });
            
            // Sauvegarder en DB
            try {
                await saveTruncatedMessageToDB(recipientIdStr, text, chunks[0]);
            } catch (error) {
                log.debug(`🔄 Erreur sauvegarde message tronqué DB: ${error.message}`);
            }
            
            // Sauvegarder immédiatement sur GitHub
            saveDataImmediate();
            
            return await sendSingleMessage(recipientIdStr, firstChunk);
        }
    }
    
    // Message normal
    return await sendSingleMessage(recipientIdStr, text);
}

async function sendSingleMessage(recipientId, text) {
    let finalText = text;
    if (finalText.length > 6000 && !finalText.includes("✨ [Message Trop long]")) {
        finalText = finalText.substring(0, 5950) + "...\n✨ [Message Trop long]";
    }
    
    const data = {
        recipient: { id: String(recipientId) },
        message: { text: finalText }
    };
    
    try {
        const response = await axios.post(
            "https://graph.facebook.com/v18.0/me/messages",
            data,
            {
                params: { access_token: PAGE_ACCESS_TOKEN },
                timeout: 15000
            }
        );
        
        if (response.status === 200) {
            return { success: true };
        } else {
            log.error(`❌ Erreur Facebook API: ${response.status}`);
            return { success: false, error: `API Error ${response.status}` };
        }
    } catch (error) {
        log.error(`❌ Erreur envoi: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function sendImageMessage(recipientId, imageUrl, caption = "") {
    if (!PAGE_ACCESS_TOKEN) {
        log.error("❌ PAGE_ACCESS_TOKEN manquant");
        return { success: false, error: "No token" };
    }
    
    if (!imageUrl) {
        log.warning("⚠️ URL d'image vide");
        return { success: false, error: "Empty image URL" };
    }
    
    const data = {
        recipient: { id: String(recipientId) },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: imageUrl,
                    is_reusable: true
                }
            }
        }
    };
    
    try {
        const response = await axios.post(
            "https://graph.facebook.com/v18.0/me/messages",
            data,
            {
                params: { access_token: PAGE_ACCESS_TOKEN },
                timeout: 20000
            }
        );
        
        if (response.status === 200) {
            if (caption) {
                await sleep(500);
                return await sendMessage(recipientId, caption);
            }
            return { success: true };
        } else {
            log.error(`❌ Erreur envoi image: ${response.status}`);
            return { success: false, error: `API Error ${response.status}` };
        }
    } catch (error) {
        log.error(`❌ Erreur envoi image: ${error.message}`);
        return { success: false, error: error.message };
    }
}
