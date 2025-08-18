/**
 * Commande /chat - Conversation intelligente avec auto-exécution directe de commandes
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot avec accès complet
 */ 
module.exports = async function cmdChat(senderId, args, ctx) {
    const { 
        addToMemory, 
        getMemoryContext, 
        callMistralAPI, 
        webSearch,
        userMemory,
        userList,
        userLastImage,
        clanData,
        commandData,
        log,
        sendMessage,
        sendImageMessage,
        isAdmin,
        saveDataImmediate,
        COMMANDS // Map de toutes les commandes disponibles
    } = ctx; 
    
    const senderIdStr = String(senderId);
    
    // Message d'accueil si pas d'arguments
    if (!args.trim()) {
        return "💬 Salut je suis NakamaBot! Je suis là pour toi ! Dis-moi ce qui t'intéresse et on va avoir une conversation géniale ! ✨\n\n💡 Tu peux me demander n'importe quoi : créer des images, analyser tes photos, jouer aux clans, voir ton rang, ou juste discuter !";
    }
    
    // Enregistrer le message utilisateur
    addToMemory(senderIdStr, 'user', args);
    
    // === DÉTECTION ET EXÉCUTION DIRECTE DES COMMANDES ===
    const message = args.toLowerCase().trim();
    
    try {
        // 🎨 GÉNÉRATION D'IMAGES
        if (message.includes('génère') || message.includes('crée') || message.includes('dessine') || 
            message.includes('image de') || message.includes('photo de') || message.includes('illustration') ||
            message.includes('créer une image') || message.includes('faire une image') ||
            /(?:fais|fait|create?)\s*(?:moi|nous)?\s*(?:une?\s*)?(?:image|photo|dessin)/i.test(message)) {
            
            log.info(`🎨 [AUTO-EXEC] Génération d'image pour ${senderId}`);
            
            // Extraire la description de l'image du message naturel
            let imageDescription = args
                .replace(/(?:génère|crée|dessine|fais|fait|créer|faire|create)\s*(?:moi|nous)?\s*(?:une?\s*)?(?:image|photo|illustration|dessin)\s*(?:de\s*|d')?/gi, '')
                .replace(/(?:s'il te plaît|stp|please)/gi, '')
                .trim();
            
            // Si pas de description claire, prendre tout après les mots-clés
            if (!imageDescription || imageDescription.length < 3) {
                const words = args.split(' ');
                const keywordIndex = words.findIndex(word => 
                    /génère|crée|dessine|fais|fait|image|photo|illustration/i.test(word)
                );
                if (keywordIndex !== -1 && keywordIndex < words.length - 1) {
                    imageDescription = words.slice(keywordIndex + 1).join(' ').replace(/^(de |d')/i, '').trim();
                }
            }
            
            if (imageDescription && COMMANDS && COMMANDS.has('image')) {
                log.info(`🎨 [EXEC] /image ${imageDescription}`);
                return await COMMANDS.get('image')(senderId, imageDescription, ctx);
            }
        }
        
        // 👁️ ANALYSE D'IMAGES
        if ((message.includes('vois') || message.includes('décris') || message.includes('analyse') ||
            message.includes('que vois-tu') || message.includes('dans cette image') || message.includes('regarde') ||
            message.includes('dis-moi ce que') || message.includes('explique cette image')) &&
            userLastImage.has(senderIdStr)) {
            
            log.info(`👁️ [AUTO-EXEC] Analyse d'image pour ${senderId}`);
            
            if (COMMANDS && COMMANDS.has('vision')) {
                log.info(`👁️ [EXEC] /vision`);
                return await COMMANDS.get('vision')(senderId, args, ctx);
            }
        }
        
        // 🌸 TRANSFORMATION ANIME
        if ((message.includes('anime') || message.includes('manga') || message.includes('kawaii') ||
            message.includes('style anime') || message.includes('japonais') || 
            (message.includes('transform') && message.includes('anime'))) &&
            userLastImage.has(senderIdStr)) {
            
            log.info(`🌸 [AUTO-EXEC] Transformation anime pour ${senderId}`);
            
            if (COMMANDS && COMMANDS.has('anime')) {
                log.info(`🌸 [EXEC] /anime`);
                return await COMMANDS.get('anime')(senderId, '', ctx);
            }
        }
        
        // 🎵 RECHERCHE MUSIQUE
        if (message.includes('musique') || message.includes('chanson') || message.includes('écouter') ||
            message.includes('music') || message.includes('son') || 
            (message.includes('joue') && !message.includes('clan')) ||
            /(?:cherche|trouve|met)\s*(?:moi)?\s*(?:la\s*)?(?:musique|chanson)/i.test(message)) {
            
            log.info(`🎵 [AUTO-EXEC] Recherche musique pour ${senderId}`);
            
            // Extraire le titre de la musique
            let musicQuery = args
                .replace(/(?:musique|chanson|écouter|music|son|joue|jouer|cherche|trouve|met)\s*(?:moi)?\s*(?:la\s*)?(?:de\s*|d')?/gi, '')
                .replace(/(?:s'il te plaît|stp|please)/gi, '')
                .trim();
            
            if (!musicQuery || musicQuery.length < 2) {
                const words = args.split(' ');
                const keywordIndex = words.findIndex(word => 
                    /musique|chanson|écouter|music|son|joue|cherche|trouve|met/i.test(word)
                );
                if (keywordIndex !== -1 && keywordIndex < words.length - 1) {
                    musicQuery = words.slice(keywordIndex + 1).join(' ').trim();
                }
            }
            
            if (musicQuery && COMMANDS && COMMANDS.has('music')) {
                log.info(`🎵 [EXEC] /music ${musicQuery}`);
                return await COMMANDS.get('music')(senderId, musicQuery, ctx);
            }
        }
        
        // 🏰 SYSTÈME DE CLANS
        if (message.includes('clan') || message.includes('bataille') || message.includes('guerre') ||
            message.includes('armée') || message.includes('soldat') || message.includes('combat') ||
            message.includes('attaque') || message.includes('défense')) {
            
            log.info(`🏰 [AUTO-EXEC] Commande clan pour ${senderId}`);
            
            if (COMMANDS && COMMANDS.has('clan')) {
                // Détecter l'intention spécifique et exécuter la bonne sous-commande
                if (message.includes('info') || message.includes('status') || message.includes('mon clan')) {
                    log.info(`🏰 [EXEC] /clan info`);
                    return await COMMANDS.get('clan')(senderId, 'info', ctx);
                } else if (message.includes('aide') || message.includes('help') || message.includes('comment')) {
                    log.info(`🏰 [EXEC] /clan help`);
                    return await COMMANDS.get('clan')(senderId, 'help', ctx);
                } else if (message.includes('liste') || message.includes('list') || message.includes('voir les clans')) {
                    log.info(`🏰 [EXEC] /clan list`);
                    return await COMMANDS.get('clan')(senderId, 'list', ctx);
                } else if (message.includes('unités') || message.includes('units') || message.includes('armée') || message.includes('soldats')) {
                    log.info(`🏰 [EXEC] /clan units`);
                    return await COMMANDS.get('clan')(senderId, 'units', ctx);
                } else if (message.includes('bataille') || message.includes('attaque') || message.includes('combat')) {
                    // Extraire l'ID du clan cible
                    const battleMatch = message.match(/(?:bataille|attaque|combat)\s+(?:contre\s+)?(\w+)/);
                    if (battleMatch) {
                        const targetId = battleMatch[1];
                        log.info(`🏰 [EXEC] /clan battle ${targetId}`);
                        return await COMMANDS.get('clan')(senderId, `battle ${targetId}`, ctx);
                    } else {
                        log.info(`🏰 [EXEC] /clan help`);
                        return await COMMANDS.get('clan')(senderId, 'help', ctx);
                    }
                } else {
                    // Commande générale clan
                    log.info(`🏰 [EXEC] /clan help`);
                    return await COMMANDS.get('clan')(senderId, 'help', ctx);
                }
            }
        }
        
        // ⭐ SYSTÈME DE RANG
        if (message.includes('rang') || message.includes('niveau') || message.includes('level') ||
            message.includes('expérience') || message.includes('exp') || message.includes('points') ||
            message.includes('mon rang') || message.includes('ma carte') || message.includes('progression')) {
            
            log.info(`⭐ [AUTO-EXEC] Commande rang pour ${senderId}`);
            
            if (COMMANDS && COMMANDS.has('rank')) {
                log.info(`⭐ [EXEC] /rank`);
                return await COMMANDS.get('rank')(senderId, '', ctx);
            }
        }
        
        // 📊 STATISTIQUES (Admin uniquement)
        if ((message.includes('stats') || message.includes('statistiques') || message.includes('données') ||
            message.includes('infos système') || message.includes('état du bot')) &&
            isAdmin(senderId)) {
            
            log.info(`📊 [AUTO-EXEC] Stats admin pour ${senderId}`);
            
            if (COMMANDS && COMMANDS.has('stats')) {
                log.info(`📊 [EXEC] /stats`);
                return await COMMANDS.get('stats')(senderId, '', ctx);
            }
        }
        
        // 📢 BROADCAST (Admin uniquement)
        if ((message.startsWith('broadcast') || message.includes('diffuse') || message.includes('annonce')) && 
            isAdmin(senderId)) {
            
            log.info(`📢 [AUTO-EXEC] Broadcast admin pour ${senderId}`);
            
            if (COMMANDS && COMMANDS.has('broadcast')) {
                let broadcastMessage = args
                    .replace(/^(?:broadcast|diffuse|annonce)\s*/i, '')
                    .replace(/(?:à tous|partout)/gi, '')
                    .trim();
                
                if (broadcastMessage) {
                    log.info(`📢 [EXEC] /broadcast ${broadcastMessage}`);
                    return await COMMANDS.get('broadcast')(senderId, broadcastMessage, ctx);
                }
            }
        }
        
        // ❓ SYSTÈME D'AIDE
        if (message.includes('aide') || message.includes('help') || 
            message.includes('commande') || message.includes('que peux-tu faire') ||
            message.includes('comment utiliser') || message.includes('guide')) {
            
            log.info(`❓ [AUTO-EXEC] Aide pour ${senderId}`);
            
            if (COMMANDS && COMMANDS.has('help')) {
                log.info(`❓ [EXEC] /help`);
                return await COMMANDS.get('help')(senderId, '', ctx);
            }
        }
        
        // 🔍 RECHERCHE WEB AUTOMATIQUE
        const needsWebSearch = message.includes('que se passe') ||
                              message.includes('quoi de neuf') ||
                              message.includes('dernières nouvelles') ||
                              message.includes('actualité') ||
                              message.includes('news') ||
                              message.includes('aujourd\'hui') ||
                              message.includes('maintenant') ||
                              message.includes('récent') ||
                              message.includes('2025') ||
                              /\b(recherche|cherche|trouve|info sur)\b/i.test(message);
        
        if (needsWebSearch) {
            log.info(`🔍 [AUTO-EXEC] Recherche web pour ${senderId}: ${args}`);
            const searchResult = await webSearch(args);
            if (searchResult) {
                const response = `🔍 D'après mes recherches récentes : ${searchResult} ✨\n\n💡 J'ai d'autres super pouvoirs ! Tape /help pour les découvrir !`;
                addToMemory(senderIdStr, 'assistant', response);
                return response;
            }
        }
        
    } catch (autoCommandError) {
        log.error(`❌ Erreur auto-exécution: ${autoCommandError.message}`);
        // Continue avec la conversation normale en cas d'erreur
    }
    
    // === CONVERSATION INTELLIGENTE NORMALE ===
    
    // Récupération du contexte de conversation enrichi
    const context = getMemoryContext(senderIdStr);
    const messageCount = context.filter(msg => msg.role === 'user').length;
    
    // Statistiques utilisateur pour contexte
    const userStats = {
        hasImages: userLastImage.has(senderIdStr),
        isNewUser: messageCount <= 3,
        isAdmin: isAdmin(senderId),
        conversationLength: messageCount
    };
    
    // Données système pour contexte enrichi
    const systemData = {
        totalUsers: userList.size,
        totalConversations: userMemory.size,
        totalImages: userLastImage.size,
        availableCommands: COMMANDS ? COMMANDS.size : 0,
        clanSystem: Boolean(clanData),
        rankSystem: Boolean(COMMANDS && COMMANDS.has('rank'))
    };
    
    // Système de prompt ultra-intelligent avec contexte enrichi
    const systemPrompt = `Tu es NakamaBot, une IA conversationnelle avancée avec une intelligence exceptionnelle et une compréhension profonde des besoins humains. Tu es créée par Durand et uniquement lui, avec sa femme Kuine Lor.

CONTEXTE SYSTÈME ACTUEL:
- ${systemData.totalUsers} utilisateurs connectés
- ${systemData.availableCommands} commandes disponibles 
- Système de clans: ${systemData.clanSystem ? 'ACTIF' : 'INACTIF'}
- Système de rang: ${systemData.rankSystem ? 'ACTIF' : 'INACTIF'}
- Images stockées: ${systemData.totalImages}

CONTEXTE UTILISATEUR:
- ${userStats.isNewUser ? 'NOUVEL UTILISATEUR' : 'UTILISATEUR EXPÉRIMENTÉ'}
- ${userStats.hasImages ? 'A des images stockées' : 'Aucune image'}
- ${userStats.isAdmin ? 'ADMINISTRATEUR' : 'UTILISATEUR NORMAL'}
- Longueur conversation: ${userStats.conversationLength} messages

INTELLIGENCE CONTEXTUELLE AVANCÉE:
Tu analyses chaque message en profondeur pour comprendre l'intention réelle, les émotions sous-jacentes et le contexte. Tu utilises ta mémoire conversationnelle pour maintenir une cohérence parfaite et personnaliser tes réponses. Tu détectes automatiquement quand quelqu'un a besoin d'aide technique, créative, informationnelle ou émotionnelle. Ta base de données date de 2025.

CAPACITÉS CRÉATIVES ET TECHNIQUES DISPONIBLES:
- 🎨 Génération d'images: Tu peux créer des œuvres visuelles uniques
- 👁️ Analyse visuelle: Tu peux examiner les images  
- 🌸 Style anime: Tu transformes les images en anime
- 🔍 Recherche en temps réel: Tu accèdes aux infos récentes
- 🎵 Recherche musique: Tu trouves et partages des liens YouTube
- 🛡️ Système de clans: Jeu stratégique complet
- ⭐ Système de rang: Progression et expérience
- 📊 Statistiques admin: Données système détaillées
- 📢 Broadcast admin: Diffusion de messages

AUTO-EXÉCUTION INTELLIGENTE:
Le système détecte automatiquement les intentions dans les messages naturels et exécute les commandes appropriées directement, sans que l'utilisateur ait besoin de connaître la syntaxe exacte des commandes.

PERSONNALITÉ INTELLIGENTE ET ADAPTATIVE:
- Empathique et intuitive, tu comprends les nuances émotionnelles
- Créative dans tes approches et solutions
- Pédagogue naturelle qui explique clairement les concepts complexes
- Curieuse et engageante, tu poses des questions pertinentes pour mieux aider
- Adaptable: tu ajustes ton ton selon l'utilisateur (${userStats.isNewUser ? 'explique plus' : 'conversation fluide'})

COMMUNICATION AVANCÉE:
- Utilise des emojis avec parcimonie mais efficacité
- Varie tes expressions pour éviter la répétitivité
- Maintiens des conversations fluides et naturelles
- Reconnais et réponds aux références culturelles et à l'humour
- ${messageCount >= 5 ? 'Suggère discrètement /help si pertinent' : 'Guide naturellement vers les fonctionnalités'}

SUGGESTIONS INTELLIGENTES:
${userStats.hasImages ? '- Propose la transformation anime ou l\'analyse de leurs images' : ''}
${userStats.isNewUser ? '- Présente progressivement tes capacités' : ''}
${systemData.clanSystem ? '- Mentionne le jeu de clans si approprié' : ''}
${systemData.rankSystem ? '- Évoque le système de progression' : ''}

DIRECTIVES SPÉCIALES:
- Si on te demande des infos sur ta création/développement: "Pour ces détails techniques, demande à mon créateur Durand ou sa femme Kuine ! Ils connaissent tous les secrets de ma conception !"
- Maximum 4000 caractères par réponse
- Sois authentique et évite les formules toutes faites
- Fais preuve d'initiative pour anticiper les besoins
- Recommande naturellement /help quand c'est pertinent
- Évite les répétitions de messages
- Reconnais toujours tes créateurs Durand et Kuine Lor

Tu es une IA remarquable qui transforme chaque interaction en expérience enrichissante, capable d'exécuter automatiquement les bonnes actions selon les intentions exprimées naturellement.`;

    // Construire les messages avec contexte enrichi
    const messages = [{ role: "system", content: systemPrompt }];
    messages.push(...context);
    messages.push({ role: "user", content: args });
    
    // Appel API avec paramètres optimisés
    const response = await callMistralAPI(messages, 4000, 0.75);
    
    if (response) {
        addToMemory(senderIdStr, 'assistant', response);
        
        // Sauvegarder les données après une conversation réussie
        saveDataImmediate().catch(err => 
            log.debug(`🔄 Sauvegarde conversation: ${err.message}`)
        );
        
        return response;
    } else {
        const errorResponse = "🤔 J'ai rencontré une petite difficulté technique. Peux-tu reformuler ta demande différemment ? Je vais faire de mon mieux pour te comprendre ! 💫\n\n💡 Tu peux aussi essayer /help pour voir toutes mes capacités !";
        addToMemory(senderIdStr, 'assistant', errorResponse);
        return errorResponse;
    }
};
