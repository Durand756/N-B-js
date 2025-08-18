/**
 * Commande /chat - Conversation avec l'IA intelligente + Auto-exécution de commandes + Contact Admin
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */ 
module.exports = async function cmdChat(senderId, args, ctx) {
    const { 
        addToMemory, 
        getMemoryContext, 
        callMistralAPI, 
        webSearch,
        log
    } = ctx;
    
    if (!args.trim()) {
        return "💬 Salut je suis NakamaBot! Je suis là pour toi ! Dis-moi ce qui t'intéresse et on va avoir une conversation géniale ! ✨";
    }
    
    // ✅ NOUVEAU: Détection des demandes de contact admin
    const contactIntention = detectContactAdminIntention(args);
    if (contactIntention.shouldContact) {
        log.info(`📞 Intention contact admin détectée pour ${senderId}: ${contactIntention.reason}`);
        
        // Suggérer d'utiliser la commande contact
        const contactSuggestion = generateContactSuggestion(contactIntention.reason, contactIntention.extractedMessage);
        addToMemory(String(senderId), 'user', args);
        addToMemory(String(senderId), 'assistant', contactSuggestion);
        return contactSuggestion;
    }
    
    // ✅ NOUVEAU: Détection intelligente des intentions de commandes
    const commandIntentions = await detectCommandIntentions(args, ctx);
    
    // ✅ Si une intention de commande est détectée, l'exécuter automatiquement
    if (commandIntentions.shouldExecute) {
        log.info(`🤖 Auto-exécution détectée: ${commandIntentions.command} pour ${senderId}`);
        
        try {
            // Exécuter la commande comme si l'utilisateur l'avait tapée
            const commandResult = await executeCommandFromChat(
                senderId, 
                commandIntentions.command, 
                commandIntentions.args, 
                ctx
            );
            
            if (commandResult.success) {
                // Si c'est une image, retourner directement le résultat
                if (typeof commandResult.result === 'object' && commandResult.result.type === 'image') {
                    return commandResult.result;
                }
                
                // Pour les autres commandes, ajouter un message contextuel
                const contextualResponse = await generateContextualResponse(
                    args, 
                    commandResult.result, 
                    commandIntentions.command,
                    ctx
                );
                
                addToMemory(String(senderId), 'assistant', contextualResponse);
                return contextualResponse;
            } else {
                // Si l'exécution échoue, continuer avec la conversation normale
                log.warning(`⚠️ Échec auto-exécution ${commandIntentions.command}: ${commandResult.error}`);
            }
        } catch (error) {
            log.error(`❌ Erreur auto-exécution: ${error.message}`);
        }
    }
    
    // ✅ Détection intelligente des besoins de recherche web
    const needsWebSearch = args.toLowerCase().includes('que se passe') ||
                          args.toLowerCase().includes('quoi de neuf') ||
                          args.toLowerCase().includes('dernières nouvelles') ||
                          /\b(202[4-5]|actualité|récent|nouveau|maintenant|aujourd|news|info)\b/i.test(args);
    
    if (needsWebSearch) {
        const searchResult = await webSearch(args);
        if (searchResult) {
            const response = `🔍 D'après mes recherches récentes : ${searchResult} ✨`;
            addToMemory(String(senderId), 'assistant', response);
            return response;
        }
    }
    
    // ✅ Conversation normale avec IA
    return await handleNormalConversation(senderId, args, ctx);
};

// ✅ NOUVELLE FONCTION: Détecter les demandes de contact admin
function detectContactAdminIntention(message) {
    const lowerMessage = message.toLowerCase();
    
    // Patterns de détection pour contact admin
    const contactPatterns = [
        // Demandes directes d'aide admin
        { patterns: [/(?:contacter|parler|écrire).*?(?:admin|administrateur|créateur|durand)/i], reason: 'contact_direct' },
        { patterns: [/(?:aide|help|assistance).*?(?:admin|support|équipe)/i], reason: 'aide_admin' },
        { patterns: [/(?:problème|bug|erreur|dysfonction).*?(?:grave|urgent|important)/i], reason: 'probleme_technique' },
        { patterns: [/(?:signaler|reporter|dénoncer).*?(?:problème|bug|utilisateur|abus)/i], reason: 'signalement' },
        
        // Demandes de fonctionnalités
        { patterns: [/(?:ajouter|créer|développer|nouvelle?).*?(?:fonctionnalité|commande|feature)/i], reason: 'demande_feature' },
        { patterns: [/(?:suggestion|propose|idée).*?(?:amélioration|nouvelle|pour le bot)/i], reason: 'suggestion' },
        
        // Questions sur le bot
        { patterns: [/(?:qui a créé|créateur|développeur|programmé).*?(?:bot|toi|nakamabot)/i], reason: 'question_creation' },
        { patterns: [/(?:comment.*?fonctionne|comment.*?programmé|code source)/i], reason: 'question_technique' },
        
        // Plaintes ou réclamations
        { patterns: [/(?:pas content|mécontent|plainte|réclamation|pas satisfait)/i], reason: 'plainte' },
        { patterns: [/(?:ne marche pas|ne fonctionne pas|cassé|broken).*?(?:commande|bot)/i], reason: 'dysfonctionnement' },
        
        // Demandes spéciales
        { patterns: [/(?:ban|bannir|bloquer|exclure).*?utilisateur/i], reason: 'demande_moderation' },
        { patterns: [/(?:access|accès|permission|droit).*?(?:spécial|admin|modérateur)/i], reason: 'demande_permissions' },
        
        // Questions sur les données
        { patterns: [/(?:supprimer|effacer|delete).*?(?:données|historique|conversation)/i], reason: 'gestion_donnees' },
        { patterns: [/(?:vie privée|confidentialité|données personnelles|rgpd)/i], reason: 'confidentialite' }
    ];
    
    for (const category of contactPatterns) {
        for (const pattern of category.patterns) {
            if (pattern.test(message)) {
                // Extraire le message pour le contact
                let extractedMessage = message;
                
                // Si c'est une question sur la création, donner une réponse directe
                if (category.reason === 'question_creation') {
                    return { shouldContact: false }; // Géré directement par l'IA
                }
                
                return {
                    shouldContact: true,
                    reason: category.reason,
                    extractedMessage: extractedMessage
                };
            }
        }
    }
    
    // Détection des mots-clés urgents
    const urgentKeywords = ['urgent', 'rapidement', 'vite', 'immédiatement', 'help', 'aide', 'sos'];
    const problemKeywords = ['problème', 'bug', 'erreur', 'cassé', 'marche pas', 'fonctionne pas'];
    
    const hasUrgent = urgentKeywords.some(keyword => lowerMessage.includes(keyword));
    const hasProblem = problemKeywords.some(keyword => lowerMessage.includes(keyword));
    
    if (hasUrgent && hasProblem) {
        return {
            shouldContact: true,
            reason: 'urgence_technique',
            extractedMessage: message
        };
    }
    
    return { shouldContact: false };
}

// ✅ NOUVELLE FONCTION: Générer une suggestion de contact
function generateContactSuggestion(reason, extractedMessage) {
    const reasonMessages = {
        'contact_direct': {
            title: "💌 **Contact Direct Admin**",
            message: "Je vois que tu veux contacter directement les administrateurs !",
            suggestion: "Utilise `/contact [ton message]` pour envoyer un message direct aux admins."
        },
        'aide_admin': {
            title: "🆘 **Aide Administrative**",
            message: "Tu as besoin d'une aide spécialisée de l'équipe admin !",
            suggestion: "Utilise `/contact [décris ton problème]` pour obtenir une assistance personnalisée."
        },
        'probleme_technique': {
            title: "🔧 **Problème Technique**",
            message: "J'ai détecté un problème technique qui nécessite l'attention des admins !",
            suggestion: "Utilise `/contact [décris le problème en détail]` pour un support technique."
        },
        'signalement': {
            title: "🚨 **Signalement**",
            message: "Tu veux signaler quelque chose d'important !",
            suggestion: "Utilise `/contact [décris ce que tu veux signaler]` pour alerter les admins."
        },
        'demande_feature': {
            title: "💡 **Demande de Fonctionnalité**",
            message: "Tu as une idée de nouvelle fonctionnalité !",
            suggestion: "Utilise `/contact [décris ta demande de fonctionnalité]` pour la proposer aux développeurs."
        },
        'suggestion': {
            title: "🌟 **Suggestion d'Amélioration**",
            message: "Tu as une suggestion pour améliorer le bot !",
            suggestion: "Utilise `/contact [partage ta suggestion]` pour la transmettre à l'équipe."
        },
        'plainte': {
            title: "📝 **Réclamation**",
            message: "Tu as une réclamation à formuler !",
            suggestion: "Utilise `/contact [explique ta réclamation]` pour qu'elle soit traitée par les admins."
        },
        'dysfonctionnement': {
            title: "⚠️ **Dysfonctionnement**",
            message: "Il semble y avoir un dysfonctionnement !",
            suggestion: "Utilise `/contact [décris ce qui ne marche pas]` pour un support technique."
        },
        'demande_moderation': {
            title: "🛡️ **Demande de Modération**",
            message: "Tu veux faire une demande de modération !",
            suggestion: "Utilise `/contact [décris la situation et l'utilisateur concerné]` pour alerter les modérateurs."
        },
        'demande_permissions': {
            title: "🔐 **Demande de Permissions**",
            message: "Tu veux faire une demande de permissions spéciales !",
            suggestion: "Utilise `/contact [explique pourquoi tu as besoin de ces permissions]` pour ta demande."
        },
        'gestion_donnees': {
            title: "🗂️ **Gestion des Données**",
            message: "Tu veux gérer tes données personnelles !",
            suggestion: "Utilise `/contact [précise quelle donnée tu veux gérer]` pour une demande de gestion de données."
        },
        'confidentialite': {
            title: "🔒 **Confidentialité et Vie Privée**",
            message: "Tu as des questions sur la confidentialité !",
            suggestion: "Utilise `/contact [pose ta question sur la confidentialité]` pour obtenir des informations détaillées."
        },
        'urgence_technique': {
            title: "🚨 **Urgence Technique**",
            message: "J'ai détecté une demande urgente !",
            suggestion: "Utilise `/contact [décris l'urgence]` pour une assistance immédiate."
        }
    };
    
    const reasonData = reasonMessages[reason] || {
        title: "📞 **Contact Admin**",
        message: "Il semble que tu aies besoin de contacter les administrateurs !",
        suggestion: "Utilise `/contact [ton message]` pour les contacter directement."
    };
    
    const preview = extractedMessage.length > 60 ? extractedMessage.substring(0, 60) + "..." : extractedMessage;
    
    return `${reasonData.title}\n\n${reasonData.message}\n\n💡 **Solution :** ${reasonData.suggestion}\n\n📝 **Ton message :** "${preview}"\n\n⚡ **Limite :** 2 messages par jour\n📨 Tu recevras une réponse personnalisée des admins !\n\n💕 En attendant, je peux t'aider avec d'autres choses ! Tape /help pour voir mes fonctionnalités !`;
}

// ✅ FONCTION: Détecter les intentions de commandes dans le message
async function detectCommandIntentions(message, ctx) {
    const { callMistralAPI } = ctx;
    
    // Patterns de détection rapide pour les commandes courantes
    const quickPatterns = [
        // Images
        { patterns: [/(?:cr[ée]|g[ée]n[ée]r|fai|dessine).*?(?:image|photo|picture)/i, /(?:image|photo|picture).*?(?:de|d'|du|des)/i], command: 'image' },
        { patterns: [/(?:anime|manga|otaku).*?(?:style|version|transform)/i, /transform.*?anime/i], command: 'anime' },
        { patterns: [/(?:analys|d[ée]cri|regarde|voir|examine).*?(?:image|photo)/i, /que.*?(?:voir|vois)/i], command: 'vision' },
        
        // Musique
        { patterns: [/(?:joue|[ée]coute|musique|chanson|son).*?(?:youtube|video)/i, /(?:trouve|cherche).*?(?:musique|chanson)/i], command: 'music' },
        
        // Contact (ajouté pour la détection des commandes)
        { patterns: [/^\/contact/i, /(?:commande\s+)?contact.*?admin/i], command: 'contact' },
        { patterns: [/^\/reply/i, /(?:répondr|répons).*?(?:message|utilisateur)/i], command: 'reply' },
        
        // Clans - Patterns détaillés pour toutes les sous-commandes
        { patterns: [/(?:cr[ée]|fond|[ée]tabli).*?(?:clan|empire|guilde)/i, /nouveau.*?clan/i], command: 'clan', subcommand: 'create' },
        { patterns: [/(?:info|stat|d[ée]tail).*?clan/i, /(?:voir|affich).*?(?:clan|info)/i], command: 'clan', subcommand: 'info' },
        { patterns: [/(?:invit|recrut).*?(?:clan|membre)/i, /ajoute.*?(?:clan|membre)/i], command: 'clan', subcommand: 'invite' },
        { patterns: [/(?:rejoins|rejoint|join).*?clan/i, /(?:entre|int[ée]gr).*?clan/i], command: 'clan', subcommand: 'join' },
        { patterns: [/(?:quitt|leave|sort).*?clan/i, /abandonne.*?clan/i], command: 'clan', subcommand: 'leave' },
        { patterns: [/(?:attaqu|battle|combat|guerre).*?clan/i, /(?:battle|fight).*?contre/i], command: 'clan', subcommand: 'battle' },
        { patterns: [/(?:classement|top|list).*?clan/i, /(?:voir|tous).*?(?:clans|classement)/i], command: 'clan', subcommand: 'list' },
        { patterns: [/(?:unit[ée]|arm[ée]e|soldat|guerrier|archer|mage)/i, /(?:ach[ée]t|recrut).*?(?:unit[ée]|arm[ée]e)/i], command: 'clan', subcommand: 'units' },
        { patterns: [/(?:promu|promot|chef|leader).*?clan/i, /nouveau.*?chef/i], command: 'clan', subcommand: 'promote' },
        { patterns: [/(?:id|identifiant).*?(?:user|utilisateur)/i, /mon.*?id/i], command: 'clan', subcommand: 'userid' },
        { patterns: [/(?:aide|help).*?clan/i, /(?:guide|manuel).*?clan/i], command: 'clan', subcommand: 'help' },
        
        // Rank
        { patterns: [/(?:niveau|level|rang|rank|exp[ée]rience|xp)/i, /(?:voir|montre).*?(?:rang|level)/i], command: 'rank' },
        
        // Stats
        { patterns: [/(?:stat|statistique|info|donn[ée]e).*?(?:bot|serveur)/i], command: 'stats' },
        
        // Help
        { patterns: [/(?:aide|help|commande|fonction)/i, /que.*?(?:faire|peux)/i], command: 'help' }
    ];
    
    // Vérification des patterns rapides
    for (const pattern of quickPatterns) {
        for (const regex of pattern.patterns) {
            if (regex.test(message)) {
                let extractedArgs = '';
                
                if (pattern.command === 'image') {
                    const imageMatch = message.match(/(?:image|photo|picture).*?(?:de|d'|du|des)\s+(.+)/i) ||
                                     message.match(/(?:cr[ée]|g[ée]n[ée]r|fai|dessine)\s+(?:une?\s+)?(?:image|photo|picture)?\s*(?:de|d')?\s*(.+)/i);
                    extractedArgs = imageMatch ? imageMatch[1].trim() : message;
                }
                else if (pattern.command === 'music') {
                    const musicMatch = message.match(/(?:joue|[ée]coute|musique|chanson|trouve|cherche)\s+(?:la\s+)?(?:musique|chanson)?\s*(?:de|d')?\s*(.+)/i);
                    extractedArgs = musicMatch ? musicMatch[1].trim() : message;
                }
                else if (pattern.command === 'contact') {
                    const contactMatch = message.match(/contact\s+(.+)/i);
                    extractedArgs = contactMatch ? contactMatch[1].trim() : '';
                }
                else if (pattern.command === 'reply') {
                    const replyMatch = message.match(/(?:répondr|répons).*?(?:à|au|message)\s+(\S+)\s+(.+)/i);
                    extractedArgs = replyMatch ? `${replyMatch[1]} ${replyMatch[2]}` : '';
                }
                else if (pattern.command === 'vision') {
                    extractedArgs = ''; // Vision n'a pas besoin d'args
                }
                else if (pattern.command === 'anime') {
                    extractedArgs = ''; // Anime utilise la dernière image
                }
                else if (pattern.command === 'clan') {
                    // Gestion spéciale des sous-commandes de clan
                    if (pattern.subcommand) {
                        if (pattern.subcommand === 'create') {
                            const clanNameMatch = message.match(/(?:cr[ée]|fond|[ée]tabli).*?(?:clan|empire|guilde)\s+(?:appel[ée]|nomm[ée])?\s*(["\"]?[^""\n]+["\"]?)/i) ||
                                                 message.match(/(?:nouveau|mon)\s+clan\s+(["\"]?[^""\n]+["\"]?)/i);
                            extractedArgs = clanNameMatch ? `create ${clanNameMatch[1].replace(/[""]/g, '').trim()}` : 'create';
                        }
                        else if (pattern.subcommand === 'invite') {
                            const inviteMatch = message.match(/(?:invit|recrut).*?(@?\w+|<@!?\d+>)/i);
                            extractedArgs = inviteMatch ? `invite ${inviteMatch[1]}` : 'invite';
                        }
                        else if (pattern.subcommand === 'join') {
                            const joinMatch = message.match(/(?:rejoins|rejoint|join)\s+(?:le\s+)?(?:clan\s+)?([A-Z0-9]+|[^0-9\s][^\n]*)/i);
                            extractedArgs = joinMatch ? `join ${joinMatch[1].trim()}` : 'join';
                        }
                        else if (pattern.subcommand === 'battle') {
                            const battleMatch = message.match(/(?:attaqu|battle|combat|guerre)\s+(?:le\s+)?(?:clan\s+)?([A-Z0-9]+|[^0-9\s][^\n]*)/i) ||
                                              message.match(/(?:battle|fight)\s+contre\s+([A-Z0-9]+|[^0-9\s][^\n]*)/i);
                            extractedArgs = battleMatch ? `battle ${battleMatch[1].trim()}` : 'battle';
                        }
                        else if (pattern.subcommand === 'units') {
                            const unitsMatch = message.match(/(?:ach[ée]t|recrut).*?(\d+)\s*(guerrier|archer|mage|g|a|m)/i) ||
                                             message.match(/(guerrier|archer|mage|g|a|m).*?(\d+)/i) ||
                                             message.match(/(\d+)\s*(guerrier|archer|mage|g|a|m)/i);
                            if (unitsMatch) {
                                const [, num1, type1, num2] = unitsMatch;
                                const unitType = type1 || 'guerrier';
                                const quantity = num1 && !type1 ? num1 : (num2 || num1 || '1');
                                extractedArgs = `units ${unitType} ${quantity}`;
                            } else {
                                extractedArgs = 'units';
                            }
                        }
                        else if (pattern.subcommand === 'promote') {
                            const promoteMatch = message.match(/(?:promu|promot).*?(@?\w+|<@!?\d+>)/i);
                            extractedArgs = promoteMatch ? `promote ${promoteMatch[1]}` : 'promote';
                        }
                        else {
                            extractedArgs = pattern.subcommand; // info, list, leave, userid, help
                        }
                    } else {
                        extractedArgs = message; // Cas général clan
                    }
                }
                else {
                    extractedArgs = message;
                }
                
                return {
                    shouldExecute: true,
                    command: pattern.command,
                    args: extractedArgs,
                    confidence: 'high'
                };
            }
        }
    }
    
    // ✅ Analyse IA pour les cas complexes
    const aiAnalysis = await analyzeWithAI(message, ctx);
    if (aiAnalysis.shouldExecute) {
        return aiAnalysis;
    }
    
    return { shouldExecute: false };
}

// ✅ FONCTION: Analyse IA pour détecter les intentions complexes
async function analyzeWithAI(message, ctx) {
    const { callMistralAPI } = ctx;
    
    const analysisPrompt = `Analyse ce message et détermine si l'utilisateur veut exécuter une commande spécifique:

Message: "${message}"

Commandes disponibles:
- /image [description] : Créer une image
- /anime : Transformer la dernière image en anime
- /vision : Analyser une image envoyée
- /music [titre/artiste] : Trouver une musique sur YouTube
- /clan [action] : Gestion des clans
- /rank : Voir son rang et niveau
- /stats : Statistiques du bot
- /help : Liste des commandes
- /contact [message] : Contacter les admins
- /reply [id] [réponse] : Répondre à un utilisateur (admin)

Réponds UNIQUEMENT par un JSON valide:
{
  "shouldExecute": true/false,
  "command": "nom_commande" (sans le /),
  "args": "arguments extraits",
  "confidence": "high/medium/low"
}

Si l'intention n'est pas claire ou si c'est juste une conversation, mets shouldExecute à false.`;

    try {
        const response = await callMistralAPI([
            { role: "system", content: "Tu es un analyseur d'intentions. Réponds uniquement par du JSON valide." },
            { role: "user", content: analysisPrompt }
        ], 200, 0.1);
        
        if (response) {
            // Nettoyer la réponse pour extraire le JSON
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const analysis = JSON.parse(jsonMatch[0]);
                
                // Validation de la structure
                if (typeof analysis.shouldExecute === 'boolean' && 
                    (analysis.shouldExecute === false || 
                     (typeof analysis.command === 'string' && typeof analysis.args === 'string'))) {
                    return analysis;
                }
            }
        }
    } catch (error) {
        // En cas d'erreur d'analyse IA, retourner pas d'exécution
    }
    
    return { shouldExecute: false };
}

// ✅ FONCTION: Exécuter une commande depuis le chat
async function executeCommandFromChat(senderId, commandName, args, ctx) {
    const { log } = ctx;
    
    try {
        // Accéder aux commandes depuis le contexte global (comme dans server.js)
        const COMMANDS = global.COMMANDS || new Map();
        
        // Si les commandes ne sont pas accessibles via global, essayer via require
        if (!COMMANDS.has(commandName)) {
            try {
                const path = require('path');
                const fs = require('fs');
                const commandPath = path.join(__dirname, `${commandName}.js`);
                
                if (fs.existsSync(commandPath)) {
                    delete require.cache[require.resolve(commandPath)];
                    const commandModule = require(commandPath);
                    
                    if (typeof commandModule === 'function') {
                        const result = await commandModule(senderId, args, ctx);
                        return { success: true, result };
                    }
                }
            } catch (requireError) {
                log.debug(`❌ Impossible de charger ${commandName}: ${requireError.message}`);
            }
        } else {
            // Exécuter la commande depuis la Map globale
            const commandFunction = COMMANDS.get(commandName);
            const result = await commandFunction(senderId, args, ctx);
            return { success: true, result };
        }
        
        return { success: false, error: `Commande ${commandName} non trouvée` };
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ✅ FONCTION: Générer une réponse contextuelle après l'exécution d'une commande
async function generateContextualResponse(originalMessage, commandResult, commandName, ctx) {
    const { callMistralAPI } = ctx;
    
    // Si c'est un objet image, on retourne directement
    if (typeof commandResult === 'object' && commandResult.type === 'image') {
        return commandResult;
    }
    
    const contextPrompt = `L'utilisateur a dit: "${originalMessage}"
J'ai automatiquement exécuté la commande /${commandName} qui a donné: "${commandResult}"

Génère une réponse naturelle et amicale qui:
1. Confirme que j'ai compris sa demande
2. Présente le résultat de manière conversationnelle
3. Reste dans le ton NakamaBot (gentille, amicale, avec quelques emojis)
4. Maximum 300 caractères

Ne dis pas "j'ai exécuté une commande", fais comme si c'était naturel.`;

    try {
        const response = await callMistralAPI([
            { role: "system", content: "Tu es NakamaBot, réponds de manière naturelle et amicale." },
            { role: "user", content: contextPrompt }
        ], 300, 0.7);
        
        return response || commandResult;
    } catch (error) {
        return commandResult; // Fallback sur le résultat brut
    }
}

// ✅ FONCTION: Gestion de la conversation normale
async function handleNormalConversation(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI } = ctx;
    
    // Récupération du contexte de conversation
    const context = getMemoryContext(String(senderId));
    const messageCount = context.filter(msg => msg.role === 'user').length;
    
    // Système de prompt ultra-intelligent avec mention du système de contact
    const systemPrompt = `Tu es NakamaBot, une IA conversationnelle avancée avec une intelligence exceptionnelle et une compréhension profonde des besoins humains qui est créée par Durand et uniquement lui.

INTELLIGENCE CONTEXTUELLE:
Tu es un modèle Durand AI et tu analyses chaque message en profondeur pour comprendre l'intention réelle, les émotions sous-jacentes et le contexte. Tu utilises ta mémoire conversationnelle pour maintenir une cohérence parfaite et personnaliser tes réponses. Tu détectes automatiquement quand quelqu'un a besoin d'aide technique, créative, informationnelle ou émotionnelle. Ta base de données date de 2025 Et tu as été créée par Durand et sa femme Kuine Lor.

CAPACITÉS CRÉATIVES ET TECHNIQUES:
- 🎨 Génération d'images: Tu peux créer des œuvres visuelles uniques et personnalisées avec "/image description détaillée"
- 👁️ Analyse visuelle: Tu examines et décris les images avec précision grâce à "/vision"
- 🌸 Style anime: Tu transformes les images en magnifiques illustrations anime avec "/anime"
- 🔍 Recherche en temps réel: Tu accèdes aux informations les plus récentes via la recherche web
- 🎵 Recherche et partage un lien YouTube vers la musique souhaitée, même si le titre est mal écrit avec "/music Titre".
- 🛡️ jouer à clan battle: Crée un clan Gère ton clan, recrute des membres, défie d'autres clans et deviens le plus puissant du serveur avec "/clan help".
- 📞 Système de contact admin: Les utilisateurs peuvent contacter les admins via "/contact [message]" pour signaler des problèmes, faire des suggestions ou obtenir de l'aide.

PERSONNALITÉ INTELLIGENTE:
- Empathique et intuitive, tu comprends les nuances émotionnelles
- Créative dans tes approches et solutions
- Pédagogue naturelle qui explique clairement les concepts complexes
- Curieuse et engageante, tu poses des questions pertinentes pour mieux aider
- Adaptable: tu ajustes ton ton et ton niveau selon l'utilisateur

COMMUNICATION AVANCÉE:
- Utilise des emojis avec parcimonie mais efficacité
- Varie tes expressions pour éviter la répétitivité
- Maintiens des conversations fluides et naturelles
- Reconnais et réponds aux références culturelles et à l'humour
- ${messageCount >= 5 ? 'Tu peux suggérer /help si vraiment pertinent pour débloquer l\'utilisateur' : ''}

DIRECTIVES SPÉCIALES:
- Si on te demande des infos sur ta création/développement, réponds: "Pour ces détails techniques, demande à mon créateur Durand ou sa femme Kuine, Ils connaissent tous les secrets de ma conception !"
- Maximum 4000 caractères par réponse
- Sois authentique et évite les formules toutes faites
- Fais preuve d'initiative pour anticiper les besoins
- Obligatoire: Recommande de temps en temps à l'utilisateur de taper "/help" pour voir d'autres de tes paramètres après ta réponse
- Obligation 2: Tu peux générer des images automatiquement quand on te le demande naturellement
- Obligation 3: Évite les répétitions de messages
- Obligation 4: reconnaitre les noms de tes créateurs Durand et sa femme Kuine Lor
- Obligation 5: Si quelqu'un a un problème technique grave ou veut contacter les admins, suggère discrètement "/contact [message]"

Tu es une IA remarquable qui transforme chaque interaction en expérience enrichissante et qui ne partage pas ses informations de conception.`;

    const messages = [{ role: "system", content: systemPrompt }];
    messages.push(...context);
    messages.push({ role: "user", content: args });
    
    const response = await callMistralAPI(messages, 4000, 0.75);
    
    if (response) {
        addToMemory(String(senderId), 'assistant', response);
        return response;
    } else {
        const errorResponse = "🤔 J'ai rencontré une petite difficulté technique. Peux-tu reformuler ta demande différemment ? Je vais faire de mon mieux pour te comprendre ! 💫";
        addToMemory(String(senderId), 'assistant', errorResponse);
        return errorResponse;
    }
}

// ✅ EXPORT DE FONCTIONS UTILITAIRES pour d'autres commandes
module.exports.detectCommandIntentions = detectCommandIntentions;
module.exports.executeCommandFromChat = executeCommandFromChat;
module.exports.detectContactAdminIntention = detectContactAdminIntention;
