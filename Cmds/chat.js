/**
 * Commande /chat - Conversation intelligente avec auto-exécution de commandes
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
        COMMANDS // Accès à toutes les commandes disponibles
    } = ctx; 
    
    const senderIdStr = String(senderId);
    
    // Message d'accueil si pas d'arguments
    if (!args.trim()) {
        return "💬 Salut je suis NakamaBot! Je suis là pour toi ! Dis-moi ce qui t'intéresse et on va avoir une conversation géniale ! ✨\n\n💡 Tu peux me demander n'importe quoi : créer des images, analyser tes photos, jouer aux clans, voir ton rang, ou juste discuter !";
    }
    
    // Enregistrer le message utilisateur
    addToMemory(senderIdStr, 'user', args);
    
    // === DÉTECTION INTELLIGENTE DES INTENTIONS ET AUTO-EXÉCUTION ===
    const message = args.toLowerCase().trim();
    
    try {
        // 🎨 AUTO-GÉNÉRATION D'IMAGES
        if (message.includes('génère') || message.includes('crée') || message.includes('dessine') || 
            message.includes('image de') || message.includes('photo de') || message.includes('illustration') ||
            message.includes('créer une image') || message.includes('faire une image')) {
            
            log.info(`🎨 Auto-génération d'image détectée pour ${senderId}`);
            
            // Extraire la description de l'image
            let imageDescription = args.replace(/(?:génère|crée|dessine|fais|créer|faire)\s*(?:une?\s*)?(?:image|photo|illustration)\s*(?:de\s*)?/gi, '').trim();
            
            if (!imageDescription) {
                imageDescription = args.replace(/(?:génère|crée|dessine|fais)/gi, '').trim();
            }
            
            if (imageDescription && ctx.COMMANDS && ctx.COMMANDS.has('image')) {
                const imageResult = await ctx.COMMANDS.get('image')(senderId, imageDescription, ctx);
                
                if (imageResult && typeof imageResult === 'object' && imageResult.type === 'image') {
                    const caption = `🎨 Voilà ton image créée avec amour ! ✨\n\n💡 Tape /anime pour la transformer en style anime !\n👁️ Ou continue à me parler !`;
                    return { type: 'image', url: imageResult.url, caption: caption };
                } else if (typeof imageResult === 'string') {
                    return imageResult;
                }
            }
        }
        
        // 👁️ AUTO-ANALYSE D'IMAGES
        if ((message.includes('vois') || message.includes('décris') || message.includes('analyse') ||
            message.includes('que vois-tu') || message.includes('dans cette image') || message.includes('regarde')) &&
            userLastImage.has(senderIdStr)) {
            
            log.info(`👁️ Auto-analyse d'image détectée pour ${senderId}`);
            
            if (ctx.COMMANDS && ctx.COMMANDS.has('vision')) {
                const visionResult = await ctx.COMMANDS.get('vision')(senderId, args, ctx);
                if (visionResult) {
                    return visionResult;
                }
            }
        }
        
        // 🌸 AUTO-TRANSFORMATION ANIME
        if ((message.includes('anime') || message.includes('manga') || message.includes('kawaii') ||
            message.includes('style anime') || message.includes('transform') && message.includes('anime')) &&
            userLastImage.has(senderIdStr)) {
            
            log.info(`🌸 Auto-transformation anime détectée pour ${senderId}`);
            
            if (ctx.COMMANDS && ctx.COMMANDS.has('anime')) {
                const animeResult = await ctx.COMMANDS.get('anime')(senderId, args, ctx);
                if (animeResult) {
                    return animeResult;
                }
            }
        }
        
        // 🎵 AUTO-RECHERCHE MUSIQUE
        if (message.includes('musique') || message.includes('chanson') || message.includes('écouter') ||
            message.includes('music') || message.includes('son') || (message.includes('joue') && !message.includes('clan'))) {
            
            log.info(`🎵 Auto-recherche musique détectée pour ${senderId}`);
            
            let musicQuery = args.replace(/(?:musique|chanson|écouter|music|son|joue|jouer)\s*/gi, '').trim();
            
            if (musicQuery && ctx.COMMANDS && ctx.COMMANDS.has('music')) {
                const musicResult = await ctx.COMMANDS.get('music')(senderId, musicQuery, ctx);
                if (musicResult) {
                    return musicResult;
                }
            }
        }
        
        // 🏰 AUTO-COMMANDES CLANS
        if (message.includes('clan') || message.includes('bataille') || message.includes('guerre') ||
            message.includes('armée') || message.includes('soldat') || message.includes('combat')) {
            
            log.info(`🏰 Auto-commande clan détectée pour ${senderId}`);
            
            if (ctx.COMMANDS && ctx.COMMANDS.has('clan')) {
                // Détecter l'intention spécifique
                if (message.includes('info') || message.includes('status')) {
                    return await ctx.COMMANDS.get('clan')(senderId, 'info', ctx);
                } else if (message.includes('aide') || message.includes('help')) {
                    return await ctx.COMMANDS.get('clan')(senderId, 'help', ctx);
                } else if (message.includes('liste') || message.includes('list')) {
                    return await ctx.COMMANDS.get('clan')(senderId, 'list', ctx);
                } else if (message.includes('unités') || message.includes('units') || message.includes('armée')) {
                    return await ctx.COMMANDS.get('clan')(senderId, 'units', ctx);
                } else {
                    // Suggestion générale
                    return "🏰 Tu t'intéresses aux clans ! Super ! 🎮\n\n" +
                           "🔹 Tape **/clan help** pour voir toutes les commandes\n" +
                           "🔹 **/clan info** pour tes stats\n" +
                           "🔹 **/clan list** pour voir les clans\n" +
                           "🔹 **/clan units** pour gérer ton armée\n\n" +
                           "💬 Ou dis-moi plus précisément ce que tu veux faire !";
                }
            }
        }
        
        // ⭐ AUTO-COMMANDE RANG
        if (message.includes('rang') || message.includes('niveau') || message.includes('level') ||
            message.includes('expérience') || message.includes('exp') || message.includes('points')) {
            
            log.info(`⭐ Auto-commande rang détectée pour ${senderId}`);
            
            if (ctx.COMMANDS && ctx.COMMANDS.has('rank')) {
                const rankResult = await ctx.COMMANDS.get('rank')(senderId, '', ctx);
                if (rankResult) {
                    return rankResult;
                }
            }
        }
        
        // 🔍 AUTO-RECHERCHE WEB
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
            log.info(`🔍 Auto-recherche web détectée pour ${senderId}`);
            const searchResult = await webSearch(args);
            if (searchResult) {
                const response = `🔍 D'après mes recherches récentes : ${searchResult} ✨\n\n💡 J'ai d'autres super pouvoirs ! Tape /help pour les découvrir !`;
                addToMemory(senderIdStr, 'assistant', response);
                return response;
            }
        }
        
        // 📊 AUTO-STATISTIQUES (Admin uniquement)
        if ((message.includes('stats') || message.includes('statistiques') || message.includes('données')) &&
            isAdmin(senderId)) {
            
            log.info(`📊 Auto-statistiques admin détectées pour ${senderId}`);
            
            if (ctx.COMMANDS && ctx.COMMANDS.has('stats')) {
                const statsResult = await ctx.COMMANDS.get('stats')(senderId, '', ctx);
                if (statsResult) {
                    return statsResult;
                }
            }
        }
        
        // 📢 AUTO-BROADCAST (Admin uniquement) 
        if (message.startsWith('broadcast') && isAdmin(senderId)) {
            log.info(`📢 Auto-broadcast admin détecté pour ${senderId}`);
            
            if (ctx.COMMANDS && ctx.COMMANDS.has('broadcast')) {
                const broadcastMessage = args.replace(/^broadcast\s*/i, '').trim();
                const broadcastResult = await ctx.COMMANDS.get('broadcast')(senderId, broadcastMessage, ctx);
                if (broadcastResult) {
                    return broadcastResult;
                }
            }
        }
        
        // ❓ AUTO-AIDE
        if (message.includes('aide') || message.includes('help') || 
            message.includes('commande') || message.includes('que peux-tu faire')) {
            
            log.info(`❓ Auto-aide détectée pour ${senderId}`);
            
            if (ctx.COMMANDS && ctx.COMMANDS.has('help')) {
                const helpResult = await ctx.COMMANDS.get('help')(senderId, '', ctx);
                if (helpResult) {
                    return helpResult;
                }
            }
        }
        
    } catch (autoCommandError) {
        log.error(`❌ Erreur auto-commande: ${autoCommandError.message}`);
        // Continue avec la conversation normale
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
        availableCommands: ctx.COMMANDS ? ctx.COMMANDS.size : 0,
        clanSystem: Boolean(ctx.clanData),
        rankSystem: Boolean(ctx.COMMANDS && ctx.COMMANDS.has('rank'))
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
- 🎨 Génération d'images: Tu peux créer des œuvres visuelles uniques avec la commande /image
- 👁️ Analyse visuelle: Tu peux examiner les images avec /vision
- 🌸 Style anime: Tu transformes les images en anime avec /anime  
- 🔍 Recherche en temps réel: Tu accèdes aux infos récentes
- 🎵 Recherche musique: Tu trouves et partages des liens YouTube avec /music
- 🛡️ Système de clans: Jeu stratégique complet avec /clan
- ⭐ Système de rang: Progression et expérience avec /rank
- 📊 Statistiques admin: Données système détaillées
- 📢 Broadcast admin: Diffusion de messages

AUTO-EXÉCUTION INTELLIGENTE:
Quand un utilisateur exprime une intention claire (créer image, voir rang, jouer clan, etc.), j'exécute automatiquement la commande appropriée pour une expérience fluide et naturelle.

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
${userStats.hasImages ? '- Propose /anime ou /vision pour leurs images' : ''}
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

Tu es une IA remarquable qui transforme chaque interaction en expérience enrichissante, avec la capacité d'exécuter automatiquement des actions pour fluidifier l'expérience utilisateur.`;

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
