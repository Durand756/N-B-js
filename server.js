async function processCommand(senderId, messageText) {
    const senderIdStr = String(senderId);
    
    if (!messageText || typeof messageText !== 'string') {
        return "🤖 Oh là là ! Message vide ! Tape /start ou /help pour commencer notre belle conversation ! 💕";
    }
    
    messageText = messageText.trim();
    
    // Gestion des demandes de continuation en priorité + SQLite
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
                    const newTruncData = {
                        fullMessage: fullMessage,
                        lastSentPart: lastSentPart + nextChunk
                    };
                    truncatedMessages.set(senderIdStr, newTruncData);
                    
                    // Sauvegarder dans SQLite aussi
                    saveTruncatedToDb(senderIdStr, fullMessage, lastSentPart + nextChunk);
                    
                    // Ajouter un indicateur de continuation
                    const continuationMsg = nextChunk + "\n\n📝 *Tape \"continue\" pour la suite...*";
                    addToMemory(senderIdStr, 'user', messageText);
                    addToMemory(senderIdStr, 'assistant', continuationMsg);
                    saveDataImmediate();
                    return continuationMsg;
                } else {
                    // Message terminé
                    truncatedMessages.delete(senderIdStr);
                    // Supprimer de SQLite aussi
                    if (db) {
                        db.run('DELETE FROM truncated_messages WHERE user_id = ?', [senderIdStr])
                          .catch(err => log.debug(`Erreur suppression SQLite: ${err.message}`));
                    }
                    
                    addToMemory(senderIdStr, 'user', messageText);
                    addToMemory(senderIdStr, 'assistant', nextChunk);
                    saveDataImmediate();
                    return nextChunk;
                }
            } else {
                // Plus rien à envoyer
                truncatedMessages.delete(senderIdStr);
                // Supprimer de SQLite aussi
                if (db) {
                    db.run('DELETE FROM truncated_messages WHERE user_id = ?', [senderIdStr])
                      .catch(err => log.debug(`Erreur suppression SQLite: ${err.message}`));
                }
                
                const endMsg = "✅ C'est tout ! Y a-t-il autre chose que je puisse faire pour toi ? 💫";
                addToMemory(senderIdStr, 'user', messageText);
                addToMemory(senderIdStr, 'assistant', endMsg);
                saveDataImmediate();
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

// Route d'accueil mise à jour avec SQLite
app.get('/', async (req, res) => {
    try {
        const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
        const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
        const dbStats = await getDbStats();
        
        res.json({
            status: "🤖 NakamaBot v4.0 Amicale + Vision + GitHub + SQLite + Clans + Rank + Truncation Online ! 💖",
            creator: "Durand",
            personality: "Super gentille et amicale, comme une très bonne amie",
            year: "2025",
            commands: COMMANDS.size,
            storage: {
                memory: {
                    users: userList.size,
                    conversations: userMemory.size,
                    images: userLastImage.size,
                    clans: clanCount,
                    users_with_exp: expDataCount,
                    truncated_messages: truncatedMessages.size
                },
                database: dbStats
            },
            version: "4.0 Amicale + Vision + GitHub + SQLite + Clans + Rank + Truncation",
            persistent_storage: {
                github: {
                    type: "GitHub API",
                    repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
                    enabled: Boolean(GITHUB_TOKEN && GITHUB_USERNAME),
                    auto_save: "Every 5 minutes"
                },
                database: {
                    type: "SQLite",
                    file: "nakamabot.db",
                    enabled: Boolean(db),
                    real_time: true
                }
            },
            features: [
                "Génération d'images IA",
                "Transformation anime", 
                "Analyse d'images IA",
                "Chat intelligent et doux",
                "Système de clans persistant",
                "Système de ranking et expérience",
                "Cartes de rang personnalisées",
                "Gestion intelligente des messages longs",
                "Continuation automatique des réponses",
                "Base de données SQLite locale",
                "Broadcast admin",
                "Recherche 2025",
                "Stats réservées admin",
                "Double sauvegarde (GitHub + SQLite)"
            ],
            last_update: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: "Error loading stats",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
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

// Webhook principal modifié - Ajout SQLite + expérience et notifications de niveau
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
                    
                    // Sauvegarder l'utilisateur dans SQLite
                    if (wasNewUser) {
                        log.info(`👋 Nouvel utilisateur: ${senderId}`);
                        await saveUserToDb(senderIdStr);
                        saveDataImmediate();
                    } else {
                        // Mettre à jour la dernière activité
                        await saveUserToDb(senderIdStr);
                    }
                    
                    if (event.message.attachments) {
                        for (const attachment of event.message.attachments) {
                            if (attachment.type === 'image') {
                                const imageUrl = attachment.payload?.url;
                                if (imageUrl) {
                                    userLastImage.set(senderIdStr, imageUrl);
                                    
                                    // Sauvegarder l'image dans SQLite
                                    await saveImageToDb(senderIdStr, imageUrl);
                                    
                                    log.info(`📸 Image reçue de ${senderId}`);
                                    
                                    addToMemory(senderId, 'user', '[Image envoyée]');
                                    
                                    // Ajouter de l'expérience pour l'envoi d'image + SQLite
                                    if (rankCommand) {
                                        const expResult = rankCommand.addExp(senderId, 2); // 2 XP pour une image
                                        
                                        if (expResult.levelUp) {
                                            log.info(`🎉 ${senderId} a atteint le niveau ${expResult.newLevel} (image) !`);
                                            // Sauvegarder l'expérience dans SQLite
                                            await saveUserExpToDb(senderIdStr, expResult.totalExp, expResult.newLevel);
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
                        
                        // Ajouter de l'expérience pour chaque message + SQLite
                        if (messageText && rankCommand) {
                            const expResult = rankCommand.addExp(senderId, 1);
                            
                            // Notifier si l'utilisateur a monté de niveau
                            if (expResult.levelUp) {
                                log.info(`🎉 ${senderId} a atteint le niveau ${expResult.newLevel} !`);
                                // Sauvegarder l'expérience dans SQLite
                                await saveUserExpToDb(senderIdStr, expResult.totalExp, expResult.newLevel);
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

// Routes GitHub et administration
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

app.get('/test-github', async (req, res) => {
    try {
        if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
            return res.status(400).json({
                success: false,
                error: "Configuration GitHub manquante"
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
            status: response.status,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        res.status(error.response?.status || 500).json({
            success: false,
            error: error.message,
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString()
        });
    }
});

app.post('/force-save', async (req, res) => {
    try {
        await saveDataToGitHub();
        const dbStats = await getDbStats();
        
        res.json({
            success: true,
            message: "Données sauvegardées avec succès sur GitHub !",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString(),
            stats: {
                memory: {
                    users: userList.size,
                    conversations: userMemory.size,
                    images: userLastImage.size,
                    truncated_messages: truncatedMessages.size
                },
                database: dbStats
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/reload-data', async (req, res) => {
    try {
        await loadDataFromGitHub();
        await loadDataFromDb();
        const dbStats = await getDbStats();
        
        res.json({
            success: true,
            message: "Données rechargées avec succès depuis GitHub et SQLite !",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            timestamp: new Date().toISOString(),
            stats: {
                memory: {
                    users: userList.size,
                    conversations: userMemory.size,
                    images: userLastImage.size,
                    truncated_messages: truncatedMessages.size
                },
                database: dbStats
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Nouvelle route: Statistiques de la base de données SQLite
app.get('/db-stats', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({
                success: false,
                error: "Base de données SQLite non initialisée"
            });
        }

        const stats = await getDbStats();
        
        // Statistiques détaillées
        const detailedStats = {
            ...stats,
            users_by_month: await db.all(`
                SELECT 
                    substr(first_seen, 1, 7) as month,
                    COUNT(*) as count
                FROM users 
                GROUP BY substr(first_seen, 1, 7) 
                ORDER BY month DESC 
                LIMIT 12
            `),
            top_active_users: await db.all(`
                SELECT 
                    u.id,
                    u.message_count,
                    u.image_count,
                    u.last_active
                FROM users u
                WHERE u.message_count > 0
                ORDER BY u.message_count DESC
                LIMIT 10
            `),
            recent_activity: await db.all(`
                SELECT 
                    DATE(timestamp) as date,
                    COUNT(*) as message_count
                FROM conversations
                WHERE timestamp >= datetime('now', '-30 days')
                GROUP BY DATE(timestamp)
                ORDER BY date DESC
            `)
        };

        res.json({
            success: true,
            database: "SQLite",
            file: "nakamabot.db",
            stats: detailedStats,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Statistiques publiques mises à jour avec SQLite + expérience et troncature
app.get('/stats', async (req, res) => {
    try {
        const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
        const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
        const dbStats = await getDbStats();
        
        res.json({
            memory_stats: {
                users_count: userList.size,
                conversations_count: userMemory.size,
                images_stored: userLastImage.size,
                clans_total: clanCount,
                users_with_exp: expDataCount,
                truncated_messages: truncatedMessages.size,
                commands_available: COMMANDS.size
            },
            database_stats: dbStats,
            version: "4.0 Amicale + Vision + GitHub + SQLite + Clans + Rank + Truncation",
            creator: "Durand",
            personality: "Super gentille et amicale, comme une très bonne amie",
            year: 2025,
            storage: {
                github: {
                    type: "GitHub API",
                    repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
                    persistent: Boolean(GITHUB_TOKEN && GITHUB_USERNAME),
                    auto_save_interval: "5 minutes"
                },
                database: {
                    type: "SQLite",
                    file: "nakamabot.db",
                    real_time: Boolean(db)
                }
            },
            features: [
                "AI Image Generation",
                "Anime Transformation", 
                "AI Image Analysis",
                "Friendly Chat",
                "Persistent Clan System",
                "User Ranking System",
                "Experience & Levels",
                "Smart Message Truncation",
                "Message Continuation",
                "SQLite Local Database",
                "Real-time Data Storage",
                "Admin Stats",
                "GitHub Persistent Storage"
            ]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Santé du bot mise à jour avec SQLite + expérience et troncature
app.get('/health', async (req, res) => {
    try {
        const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
        const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
        const dbStats = await getDbStats();
        
        const healthStatus = {
            status: "healthy",
            personality: "Super gentille et amicale, comme une très bonne amie",
            services: {
                ai: Boolean(MISTRAL_API_KEY),
                vision: Boolean(MISTRAL_API_KEY),
                facebook: Boolean(PAGE_ACCESS_TOKEN),
                github_storage: Boolean(GITHUB_TOKEN && GITHUB_USERNAME),
                sqlite_database: Boolean(db),
                ranking_system: Boolean(rankCommand),
                message_truncation: true
            },
            data: {
                memory: {
                    users: userList.size,
                    conversations: userMemory.size,
                    images_stored: userLastImage.size,
                    clans_total: clanCount,
                    users_with_exp: expDataCount,
                    truncated_messages: truncatedMessages.size,
                    commands_loaded: COMMANDS.size
                },
                database: dbStats
            },
            version: "4.0 Amicale + Vision + GitHub + SQLite + Clans + Rank + Truncation",
            creator: "Durand",
            repository: `${GITHUB_USERNAME}/${GITHUB_REPO}`,
            database_file: "nakamabot.db",
            timestamp: new Date().toISOString()
        };
        
        const issues = [];
        if (!MISTRAL_API_KEY) issues.push("Clé IA manquante");
        if (!PAGE_ACCESS_TOKEN) issues.push("Token Facebook manquant");
        if (!GITHUB_TOKEN || !GITHUB_USERNAME) issues.push("Configuration GitHub manquante");
        if (!db) issues.push("Base de données SQLite non initialisée");
        if (COMMANDS.size === 0) issues.push("Aucune commande chargée");
        if (!rankCommand) issues.push("Système de ranking non chargé");
        
        if (issues.length > 0) {
            healthStatus.status = "degraded";
            healthStatus.issues = issues;
        }
        
        const statusCode = healthStatus.status === "healthy" ? 200 : 503;
        res.status(statusCode).json(healthStatus);
    } catch (error) {
        res.status(503).json({
            status: "error",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Serveur de fichiers statiques pour les images temporaires
app.use('/temp', express.static(path.join(__dirname, 'temp')));

// Nettoyer les messages tronqués
app.post('/clear-truncated', async (req, res) => {
    const clearedCount = truncatedMessages.size;
    truncatedMessages.clear();
    
    // Nettoyer aussi dans SQLite
    if (db) {
        try {
            await db.run('DELETE FROM truncated_messages');
            log.info(`🧹 ${clearedCount} messages tronqués supprimés de SQLite`);
        } catch (error) {
            log.error(`❌ Erreur nettoyage SQLite: ${error.message}`);
        }
    }
    
    saveDataImmediate();
    
    res.json({
        success: true,
        message: `${clearedCount} conversations tronquées nettoyées (mémoire + SQLite)`,
        timestamp: new Date().toISOString()
    });
});

// Démarrage modifié avec SQLite + système d'expérience et troncature
async function startBot() {
    log.info("🚀 Démarrage NakamaBot v4.0 Amicale + Vision + GitHub + SQLite + Clans + Rank + Truncation");
    log.info("💖 Personnalité super gentille et amicale, comme une très bonne amie");
    log.info("👨‍💻 Créée par Durand");
    log.info("📅 Année: 2025");

    // Initialiser SQLite en premier
    log.info("🗃️ Initialisation de la base de données SQLite...");
    const dbInitialized = await initializeDatabase();
    if (!dbInitialized) {
        log.error("❌ Impossible d'initialiser SQLite - Arrêt du bot");
        process.exit(1);
    }

    // Mettre à jour le contexte des commandes avec la DB
    commandContext.db = db;

    log.info("📥 Chargement des données depuis SQLite...");
    await loadDataFromDb();

    log.info("📥 Chargement des données depuis GitHub...");
    await loadDataFromGitHub();

    loadCommands();

    if (rankCommand) {
        log.info("🎯 Système d'expérience détecté et prêt !");
    } else {
        log.warning("⚠️ Commande rank non trouvée - Système d'expérience désactivé");
    }

    const missingVars = [];
    if (!PAGE_ACCESS_TOKEN) missingVars.push("PAGE_ACCESS_TOKEN");
    if (!MISTRAL_API_KEY) missingVars.push("MISTRAL_API_KEY");
    if (!GITHUB_TOKEN) missingVars.push("GITHUB_TOKEN");
    if (!GITHUB_USERNAME) missingVars.push("GITHUB_USERNAME");

    if (missingVars.length > 0) {
        log.error(`❌ Variables manquantes: ${missingVars.join(', ')}`);
    } else {
        log.info("✅ Configuration complète OK");
    }

    const clanCount = commandContext.clanData ? Object.keys(commandContext.clanData.clans || {}).length : 0;
    const expDataCount = rankCommand ? Object.keys(rankCommand.getExpData()).length : 0;
    const dbStats = await getDbStats();

    log.info(`🎨 ${COMMANDS.size} commandes disponibles`);
    log.info(`👥 ${userList.size} utilisateurs en mémoire`);
    log.info(`💬 ${userMemory.size} conversations en mémoire`);
    log.info(`🖼️ ${userLastImage.size} images en mémoire`);
    log.info(`🏰 ${clanCount} clans en mémoire`);
    log.info(`⭐ ${expDataCount} utilisateurs avec expérience`);
    log.info(`📝 ${truncatedMessages.size} conversations tronquées en cours`);
    log.info(`🔐 ${ADMIN_IDS.size} administrateurs`);
    log.info(`📂 Repository: ${GITHUB_USERNAME}/${GITHUB_REPO}`);
    log.info(`🗃️ Base SQLite: ${dbStats.total_users_db || 0} users, ${dbStats.total_messages_db || 0} messages`);
    log.info(`🌐 Serveur sur le port ${PORT}`);
    
    startAutoSave();
    
    log.info("🎉 NakamaBot Amicale + Vision + GitHub + SQLite + Clans + Rank + Truncation prête à aider avec gentillesse !");

    app.listen(PORT, () => {
        log.info(`🌐 Serveur démarré sur le port ${PORT}`);
        log.info("💾 Sauvegarde automatique GitHub activée");
        log.info("🗃️ Base de données SQLite prête");
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
    
    // Nettoyage final des messages tronqués
    const truncatedCount = truncatedMessages.size;
    if (truncatedCount > 0) {
        log.info(`🧹 Nettoyage de ${truncatedCount} conversations tronquées en cours...`);
        truncatedMessages.clear();
        
        if (db) {
            try {
                await db.run('DELETE FROM truncated_messages');
                log.info("🗃️ Messages tronqués nettoyés de SQLite");
            } catch (error) {
                log.debug(`Erreur nettoyage SQLite: ${error.message}`);
            }
        }
    }
    
    // Fermer la connexion SQLite proprement
    if (db) {
        try {
            await db.close();
            log.info("🗃️ Connexion SQLite fermée proprement");
        } catch (error) {
            log.debug(`Erreur fermeture SQLite: ${error.message}`);
        }
    }
    
    log.info("👋 Au revoir ! Données sauvegardées sur GitHub et SQLite !");
    log.info(`📂 Repository: https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO}`);
    process.exit(0);
}

// Gestion propre de l'arrêt
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

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
    const oneDayMs = 24 * 60 * 60 * 1000;
    let cleanedCount = 0;
    
    // Nettoyer en mémoire
    for (const [userId, data] of truncatedMessages.entries()) {
        if (!data.timestamp || (now - new Date(data.timestamp).getTime() > oneDayMs)) {
            truncatedMessages.delete(userId);
            cleanedCount++;
        }
    }
    
    // Nettoyer aussi dans SQLite
    if (db && cleanedCount > 0) {
        try {
            const result = await db.run(
                `DELETE FROM truncated_messages WHERE timestamp < datetime('now', '-1 day')`
            );
            log.info(`🧹 Nettoyage automatique SQLite: ${result.changes} messages tronqués expirés supprimés`);
        } catch (error) {
            log.debug(`Erreur nettoyage SQLite automatique: ${error.message}`);
        }
    }
    
    if (cleanedCount > 0) {
        log.info(`🧹 Nettoyage automatique: ${cleanedCount} conversations tronquées expirées supprimées`);
        saveDataImmediate();
    }
}, 60 * 60 * 1000);

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
const { open } = require('sqlite');

const app = express();
app.use(bodyParser.json());

// Configuration 
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "nakamaverifytoken";
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || "";
const GITHUB_REPO = process.env.GITHUB_REPO || "nakamabot-data";
const PORT = process.env.PORT || 5000;
const ADMIN_IDS = new Set(
    (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(id => id)
);

// Mémoire du bot (stockage local temporaire + sauvegarde permanente GitHub + SQLite)
const userMemory = new Map();
const userList = new Set();
const userLastImage = new Map();
const clanData = new Map(); // Stockage des données spécifiques aux commandes

// Référence vers la commande rank pour le système d'expérience
let rankCommand = null;

// Gestion des messages tronqués avec chunks
const truncatedMessages = new Map(); // senderId -> { fullMessage, lastSentPart }

// Instance de base de données SQLite
let db = null;

// Configuration des logs
const log = {
    info: (msg) => console.log(`${new Date().toISOString()} - INFO - ${msg}`),
    error: (msg) => console.error(`${new Date().toISOString()} - ERROR - ${msg}`),
    warning: (msg) => console.warn(`${new Date().toISOString()} - WARNING - ${msg}`),
    debug: (msg) => console.log(`${new Date().toISOString()} - DEBUG - ${msg}`)
};

// === GESTION DE LA BASE DE DONNÉES SQLITE ===

async function initializeDatabase() {
    try {
        const dbPath = path.join(__dirname, 'nakamabot.db');
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        log.info(`📂 Base de données SQLite initialisée: ${dbPath}`);

        // Créer les tables si elles n'existent pas
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                first_seen TEXT,
                last_active TEXT,
                message_count INTEGER DEFAULT 0,
                image_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                message_type TEXT,
                content TEXT,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );

            CREATE TABLE IF NOT EXISTS images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                image_url TEXT,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );

            CREATE TABLE IF NOT EXISTS user_experience (
                user_id TEXT PRIMARY KEY,
                experience INTEGER DEFAULT 0,
                level INTEGER DEFAULT 1,
                last_exp_gain TEXT,
                total_messages INTEGER DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );

            CREATE TABLE IF NOT EXISTS clans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE,
                description TEXT,
                creator_id TEXT,
                member_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS clan_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                clan_id INTEGER,
                user_id TEXT,
                role TEXT DEFAULT 'member',
                joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (clan_id) REFERENCES clans (id),
                FOREIGN KEY (user_id) REFERENCES users (id)
            );

            CREATE TABLE IF NOT EXISTS truncated_messages (
                user_id TEXT PRIMARY KEY,
                full_message TEXT,
                last_sent_part TEXT,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS bot_data (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
        `);

        log.info("✅ Tables SQLite créées/vérifiées avec succès");
        return true;
    } catch (error) {
        log.error(`❌ Erreur initialisation SQLite: ${error.message}`);
        return false;
    }
}

// Sauvegarder un utilisateur dans SQLite
async function saveUserToDb(userId) {
    if (!db) return;
    
    try {
        const now = new Date().toISOString();
        await db.run(
            `INSERT OR IGNORE INTO users (id, first_seen, last_active) VALUES (?, ?, ?)`,
            [userId, now, now]
        );
        
        await db.run(
            `UPDATE users SET last_active = ? WHERE id = ?`,
            [now, userId]
        );
    } catch (error) {
        log.error(`❌ Erreur sauvegarde utilisateur SQLite: ${error.message}`);
    }
}

// Sauvegarder une conversation dans SQLite
async function saveConversationToDb(userId, messageType, content) {
    if (!db) return;
    
    try {
        const now = new Date().toISOString();
        await db.run(
            `INSERT INTO conversations (user_id, message_type, content, timestamp) VALUES (?, ?, ?, ?)`,
            [userId, messageType, content.substring(0, 2000), now]
        );
        
        // Incrémenter le compteur de messages
        if (messageType === 'user') {
            await db.run(
                `UPDATE users SET message_count = message_count + 1 WHERE id = ?`,
                [userId]
            );
        }
    } catch (error) {
        log.error(`❌ Erreur sauvegarde conversation SQLite: ${error.message}`);
    }
}

// Sauvegarder une image dans SQLite
async function saveImageToDb(userId, imageUrl) {
    if (!db) return;
    
    try {
        const now = new Date().toISOString();
        await db.run(
            `INSERT INTO images (user_id, image_url, timestamp) VALUES (?, ?, ?)`,
            [userId, imageUrl, now]
        );
        
        // Incrémenter le compteur d'images
        await db.run(
            `UPDATE users SET image_count = image_count + 1 WHERE id = ?`,
            [userId]
        );
    } catch (error) {
        log.error(`❌ Erreur sauvegarde image SQLite: ${error.message}`);
    }
}

// Sauvegarder l'expérience utilisateur dans SQLite
async function saveUserExpToDb(userId, experience, level) {
    if (!db) return;
    
    try {
        const now = new Date().toISOString();
        await db.run(
            `INSERT OR REPLACE INTO user_experience (user_id, experience, level, last_exp_gain, total_messages) 
             VALUES (?, ?, ?, ?, (SELECT COALESCE(message_count, 0) FROM users WHERE id = ?))`,
            [userId, experience, level, now, userId]
        );
    } catch (error) {
        log.error(`❌ Erreur sauvegarde expérience SQLite: ${error.message}`);
    }
}

// Sauvegarder un message tronqué dans SQLite
async function saveTruncatedToDb(userId, fullMessage, lastSentPart) {
    if (!db) return;
    
    try {
        const now = new Date().toISOString();
        await db.run(
            `INSERT OR REPLACE INTO truncated_messages (user_id, full_message, last_sent_part, timestamp) VALUES (?, ?, ?, ?)`,
            [userId, fullMessage, lastSentPart, now]
        );
    } catch (error) {
        log.error(`❌ Erreur sauvegarde message tronqué SQLite: ${error.message}`);
    }
}

// Charger les données depuis SQLite
async function loadDataFromDb() {
    if (!db) return;
    
    try {
        // Charger les utilisateurs
        const users = await db.all('SELECT id FROM users');
        users.forEach(user => userList.add(user.id));
        log.info(`✅ ${users.length} utilisateurs chargés depuis SQLite`);
        
        // Charger les conversations récentes (dernières 8 par utilisateur)
        const conversations = await db.all(`
            SELECT user_id, message_type, content, timestamp 
            FROM (
                SELECT user_id, message_type, content, timestamp,
                       ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY timestamp DESC) as rn
                FROM conversations
            ) WHERE rn <= 8
            ORDER BY user_id, timestamp ASC
        `);
        
        const conversationMap = new Map();
        conversations.forEach(conv => {
            if (!conversationMap.has(conv.user_id)) {
                conversationMap.set(conv.user_id, []);
            }
            conversationMap.get(conv.user_id).push({
                type: conv.message_type,
                content: conv.content,
                timestamp: conv.timestamp
            });
        });
        
        conversationMap.forEach((convs, userId) => {
            userMemory.set(userId, convs);
        });
        
        log.info(`✅ ${conversationMap.size} conversations chargées depuis SQLite`);
        
        // Charger les dernières images
        const images = await db.all(`
            SELECT user_id, image_url 
            FROM (
                SELECT user_id, image_url,
                       ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY timestamp DESC) as rn
                FROM images
            ) WHERE rn = 1
        `);
        
        images.forEach(img => {
            userLastImage.set(img.user_id, img.image_url);
        });
        
        log.info(`✅ ${images.length} dernières images chargées depuis SQLite`);
        
        // Charger les messages tronqués
        const truncated = await db.all('SELECT user_id, full_message, last_sent_part FROM truncated_messages');
        truncated.forEach(trunc => {
            truncatedMessages.set(trunc.user_id, {
                fullMessage: trunc.full_message,
                lastSentPart: trunc.last_sent_part
            });
        });
        
        log.info(`✅ ${truncated.length} messages tronqués chargés depuis SQLite`);
        
    } catch (error) {
        log.error(`❌ Erreur chargement SQLite: ${error.message}`);
    }
}

// Obtenir des statistiques depuis SQLite
async function getDbStats() {
    if (!db) return {};
    
    try {
        const stats = {};
        
        const userCount = await db.get('SELECT COUNT(*) as count FROM users');
        stats.total_users_db = userCount.count;
        
        const messageCount = await db.get('SELECT COUNT(*) as count FROM conversations');
        stats.total_messages_db = messageCount.count;
        
        const imageCount = await db.get('SELECT COUNT(*) as count FROM images');
        stats.total_images_db = imageCount.count;
        
        const expCount = await db.get('SELECT COUNT(*) as count FROM user_experience WHERE level > 1');
        stats.users_with_levels_db = expCount.count;
        
        const truncatedCount = await db.get('SELECT COUNT(*) as count FROM truncated_messages');
        stats.truncated_messages_db = truncatedCount.count;
        
        return stats;
    } catch (error) {
        log.error(`❌ Erreur statistiques SQLite: ${error.message}`);
        return {};
    }
}

// === FONCTIONS DE GESTION DES MESSAGES TRONQUÉS ===

function splitMessageIntoChunks(text, maxLength = 2000) {
    if (!text || text.length <= maxLength) {
        return [text];
    }
    
    const chunks = [];
    let currentChunk = '';
    const lines = text.split('\n');
    
    for (const line of lines) {
        if (currentChunk.length + line.length + 1 > maxLength) {
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
            
            if (line.length > maxLength) {
                const words = line.split(' ');
                let currentLine = '';
                
                for (const word of words) {
                    if (currentLine.length + word.length + 1 > maxLength) {
                        if (currentLine.trim()) {
                            chunks.push(currentLine.trim());
                            currentLine = word;
                        } else {
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
    
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks.length > 0 ? chunks : [text];
}

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

function encodeBase64(content) {
    return Buffer.from(JSON.stringify(content, null, 2), 'utf8').toString('base64');
}

function decodeBase64(content) {
    return JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
}

const getGitHubApiUrl = (filename) => {
    return `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${filename}`;
};

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
                        description: 'Sauvegarde des données NakamaBot avec SQLite - Créé automatiquement',
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
                    return true;
                }
            } catch (createError) {
                log.error(`❌ Erreur création repository: ${createError.message}`);
                return false;
            }
        }
    }

    return false;
}

// Variable pour éviter les sauvegardes simultanées
let isSaving = false;
let saveQueue = [];

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
        
        const dbStats = await getDbStats().catch(() => ({}));
        
        const dataToSave = {
            userList: Array.from(userList),
            userMemory: Object.fromEntries(userMemory),
            userLastImage: Object.fromEntries(userLastImage),
            userExp: rankCommand ? rankCommand.getExpData() : {},
            truncatedMessages: Object.fromEntries(truncatedMessages),
            clanData: commandContext.clanData || null,
            commandData: Object.fromEntries(clanData),
            databaseStats: dbStats,
            lastUpdate: new Date().toISOString(),
            version: "4.0 Amicale + Vision + GitHub + SQLite + Clans + Rank + Truncation"
        };

        const commitData = {
            message: `🤖 Sauvegarde automatique NakamaBot + SQLite - ${new Date().toISOString()}`,
            content: encodeBase64(dataToSave)
        };

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
        } catch (error) {
            if (error.response?.status !== 404) {
                throw error;
            }
        }

        const response = await axios.put(url, commitData, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            timeout: 15000
        });

        if (response.status === 200 || response.status === 201) {
            log.info(`💾 Données sauvegardées sur GitHub + SQLite`);
        }

    } catch (error) {
        if (error.response?.status === 404) {
            log.error("❌ Repository GitHub introuvable pour la sauvegarde (404)");
        } else if (error.response?.status === 401) {
            log.error("❌ Token GitHub invalide pour la sauvegarde (401)");
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

async function loadDataFromGitHub() {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
        log.warning("⚠️ Configuration GitHub manquante, utilisation du stockage SQLite + temporaire uniquement");
        return;
    }

    try {
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
            
            if (data.userList && Array.isArray(data.userList)) {
                data.userList.forEach(userId => userList.add(userId));
                log.info(`✅ ${data.userList.length} utilisateurs chargés depuis GitHub`);
            }

            if (data.userMemory && typeof data.userMemory === 'object') {
                Object.entries(data.userMemory).forEach(([userId, memory]) => {
                    if (Array.isArray(memory)) {
                        userMemory.set(userId, memory);
                    }
                });
                log.info(`✅ ${Object.keys(data.userMemory).length} conversations chargées depuis GitHub`);
            }

            if (data.userLastImage && typeof data.userLastImage === 'object') {
                Object.entries(data.userLastImage).forEach(([userId, imageUrl]) => {
                    userLastImage.set(userId, imageUrl);
                });
                log.info(`✅ ${Object.keys(data.userLastImage).length} images chargées depuis GitHub`);
            }

            if (data.truncatedMessages && typeof data.truncatedMessages === 'object') {
                Object.entries(data.truncatedMessages).forEach(([userId, truncData]) => {
                    if (truncData && typeof truncData === 'object') {
                        truncatedMessages.set(userId, truncData);
                    }
                });
                log.info(`✅ ${Object.keys(data.truncatedMessages).length} messages tronqués chargés depuis GitHub`);
            }

            if (data.userExp && typeof data.userExp === 'object' && rankCommand) {
                rankCommand.loadExpData(data.userExp);
                log.info(`✅ ${Object.keys(data.userExp).length} données d'expérience chargées depuis GitHub`);
            }

            if (data.clanData && typeof data.clanData === 'object') {
                commandContext.clanData = data.clanData;
                const clanCount = Object.keys(data.clanData.clans || {}).length;
                log.info(`✅ ${clanCount} clans chargés depuis GitHub`);
            }

            log.info("🎉 Données chargées avec succès depuis GitHub !");
        }
    } catch (error) {
        if (error.response?.status === 404) {
            log.warning("📁 Aucune sauvegarde trouvée sur GitHub - Première utilisation");
            const repoCreated = await createGitHubRepo();
            if (repoCreated) {
                await saveDataToGitHub();
            }
        } else {
            log.error(`❌ Erreur chargement GitHub: ${error.message}`);
        }
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
    }, 5 * 60 * 1000);
    
    log.info("🔄 Sauvegarde automatique GitHub activée (toutes les 5 minutes)");
}

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
            }
            
            if (attempt === 0) {
                await sleep(2000);
                continue;
            }
            return null;
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

async function webSearch(query) {
    try {
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

function addToMemory(userId, msgType, content) {
    if (!userId || !msgType || !content) {
        log.debug("❌ Paramètres manquants pour addToMemory");
        return;
    }
    
    if (content.length > 1500) {
        content = content.substring(0, 1400) + "...[tronqué]";
    }
    
    if (!userMemory.has(userId)) {
        userMemory.set(userId, []);
    }
    
    const memory = userMemory.get(userId);
    
    if (memory.length > 0) {
        const lastMessage = memory[memory.length - 1];
        
        if (lastMessage.type === msgType && lastMessage.content === content) {
            log.debug(`🔄 Doublon évité pour ${userId}`);
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
    
    log.debug(`💭 Ajouté en mémoire [${userId}]: ${msgType}`);
    
    // Sauvegarder aussi dans SQLite
    saveConversationToDb(userId, msgType, content);
    
    saveDataImmediate().catch(err => 
        log.debug(`🔄 Erreur sauvegarde mémoire: ${err.message}`)
    );
}

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
    const memory = userMemory.get(userId) || [];
    
    for (const msg of memory) {
        const role = msg.type === 'user' ? 'user' : 'assistant';
        context.push({ role, content: msg.content });
    }
    
    return context;
}

function isAdmin(userId) {
    return ADMIN_IDS.has(String(userId));
}

// === FONCTIONS D'ENVOI AVEC GESTION DE TRONCATURE + SQLITE ===

async function sendMessage(recipientId, text) {
    if (!PAGE_ACCESS_TOKEN) {
        log.error("❌ PAGE_ACCESS_TOKEN manquant");
        return { success: false, error: "No token" };
    }
    
    if (!text || typeof text !== 'string') {
        log.warning("⚠️ Message vide");
        return { success: false, error: "Empty message" };
    }
    
    // Gestion intelligente des messages longs + SQLite
    if (text.length > 6000) {
        log.info(`📏 Message long détecté (${text.length} chars) pour ${recipientId} - Division en chunks`);
        
        const chunks = splitMessageIntoChunks(text, 2000);
        
        if (chunks.length > 1) {
            // Envoyer le premier chunk avec indicateur de continuation
            const firstChunk = chunks[0] + "\n\n📝 *Tape \"continue\" pour la suite...*";
            
            // Sauvegarder l'état de troncature en mémoire et SQLite
            truncatedMessages.set(String(recipientId), {
                fullMessage: text,
                lastSentPart: chunks[0]
            });
            
            // Sauvegarder aussi dans SQLite
            saveTruncatedToDb(String(recipientId), text, chunks[0]);
            
            // Sauvegarder immédiatement
            saveDataImmediate();
            
            return await sendSingleMessage(recipientId, firstChunk);
        }
    }
    
    // Message normal
    return await sendSingleMessage(recipientId, text);
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

// === CHARGEMENT DES COMMANDES ===

const COMMANDS = new Map();

// === CONTEXTE DES COMMANDES AVEC SUPPORT SQLITE + CLANS ET EXPÉRIENCE ===
const commandContext = {
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
    clanData: null,
    commandData: clanData,
    truncatedMessages,
    db,
    saveUserToDb,
    saveConversationToDb,
    saveImageToDb,
    saveUserExpToDb,
    saveTruncatedToDb,
    getDbStats,
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
    splitMessageIntoChunks,
    isContinuationRequest,
    saveDataToGitHub,
    saveDataImmediate,
    loadDataFromGitHub,
    createGitHubRepo
};

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
