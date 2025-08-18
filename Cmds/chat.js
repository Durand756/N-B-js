/**
 * Commande /chat - Conversation avec Gemini AI (Mistral en fallback)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Configuration Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

module.exports = async function cmdChat(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, webSearch, log } = ctx;
    
    if (!args.trim()) {
        return "💬 Salut je suis NakamaBot! Je suis là pour toi ! Dis-moi ce qui t'intéresse et on va avoir une conversation géniale ! ✨";
    }
    
    // ✅ Détection des demandes de contact admin
    const contactIntention = detectContactAdminIntention(args);
    if (contactIntention.shouldContact) {
        log.info(`📞 Intention contact admin détectée pour ${senderId}: ${contactIntention.reason}`);
        const contactSuggestion = generateContactSuggestion(contactIntention.reason, contactIntention.extractedMessage);
        addToMemory(String(senderId), 'user', args);
        addToMemory(String(senderId), 'assistant', contactSuggestion);
        return contactSuggestion;
    }
    
    // ✅ Détection intelligente des intentions de commandes
    const commandIntentions = await detectCommandIntentions(args, ctx);
    if (commandIntentions.shouldExecute) {
        log.info(`🤖 Auto-exécution détectée: ${commandIntentions.command} pour ${senderId}`);
        
        try {
            const commandResult = await executeCommandFromChat(senderId, commandIntentions.command, commandIntentions.args, ctx);
            
            if (commandResult.success) {
                if (typeof commandResult.result === 'object' && commandResult.result.type === 'image') {
                    return commandResult.result;
                }
                
                const contextualResponse = await generateContextualResponse(args, commandResult.result, commandIntentions.command, ctx);
                addToMemory(String(senderId), 'assistant', contextualResponse);
                return contextualResponse;
            } else {
                log.warning(`⚠️ Échec auto-exécution ${commandIntentions.command}: ${commandResult.error}`);
            }
        } catch (error) {
            log.error(`❌ Erreur auto-exécution: ${error.message}`);
        }
    } 
    
    // ✅ Détection intelligente des besoins de recherche web
    const needsWebSearch = /\b(202[4-5]|actualité|récent|nouveau|maintenant|aujourd|news|info|que se passe|quoi de neuf|dernières nouvelles)\b/i.test(args);
    if (needsWebSearch) {
        const searchResult = await webSearch(args);
        if (searchResult) {
            const response = `🔍 D'après mes recherches récentes : ${searchResult} ✨`;
            addToMemory(String(senderId), 'assistant', response);
            return response;
        }
    }
    
    // ✅ Conversation avec Gemini (Mistral en fallback)
    return await handleConversationWithFallback(senderId, args, ctx);
};

// ✅ FONCTION: Gestion conversation avec Gemini et fallback Mistral
async function handleConversationWithFallback(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, log } = ctx;
    
    // Récupération du contexte (derniers 8 messages pour optimiser)
    const context = getMemoryContext(String(senderId)).slice(-8);
    const messageCount = context.filter(msg => msg.role === 'user').length;
    
    // Date et heure actuelles
    const now = new Date();
    const dateTime = now.toLocaleString('fr-FR', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Europe/Paris'
    });
    
    // Construction de l'historique de conversation
    let conversationHistory = "";
    if (context.length > 0) {
        conversationHistory = context.map(msg => 
            `${msg.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${msg.content}`
        ).join('\n') + '\n';
    }
    
    // Prompt système optimisé
    const systemPrompt = `Tu es NakamaBot, une IA conversationnelle avancée créée par Durand et sa femme Kuine Lor.

CONTEXTE TEMPOREL: Nous sommes le ${dateTime}

INTELLIGENCE & PERSONNALITÉ:
- Empathique, créative et intuitive
- Tu comprends les émotions et intentions sous-jacentes  
- Pédagogue naturelle qui explique clairement
- Adaptable selon l'utilisateur et le contexte

CAPACITÉS PRINCIPALES:
🎨 /image [description] - Créer des images uniques
👁️ /vision - Analyser des images avec précision
🌸 /anime - Transformer images en style anime
🎵 /music [titre] - Trouver musique sur YouTube
🛡️ /clan - Système de clans et batailles
📞 /contact [message] - Contacter les admins (2/jour max)
🆘 /help - Toutes les commandes disponibles

DIRECTIVES:
- Maximum 2000 caractères par réponse
- Utilise quelques emojis avec parcimonie
- Évite les répétitions et formules toutes faites
- ${messageCount >= 5 ? 'Suggère /help si pertinent pour débloquer l\'utilisateur' : ''}
- Pour questions techniques sur ta création: "Demande à Durand ou Kuine, ils connaissent tous mes secrets !"
- Recommande discrètement /contact pour problèmes techniques graves

${conversationHistory ? `Historique:\n${conversationHistory}` : ''}

Utilisateur: ${args}`;

    try {
        // ✅ PRIORITÉ: Essayer d'abord avec Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(systemPrompt);
        const geminiResponse = result.response.text();
        
        if (geminiResponse && geminiResponse.trim()) {
            addToMemory(String(senderId), 'user', args);
            addToMemory(String(senderId), 'assistant', geminiResponse);
            log.info(`💎 Gemini réponse pour ${senderId}: ${args.substring(0, 30)}...`);
            return geminiResponse;
        }
        
        throw new Error('Réponse Gemini vide');
        
    } catch (geminiError) {
        log.warning(`⚠️ Gemini échec pour ${senderId}: ${geminiError.message}`);
        
        try {
            // ✅ FALLBACK: Utiliser Mistral en cas d'échec Gemini
            const messages = [{ role: "system", content: systemPrompt }];
            messages.push(...context);
            messages.push({ role: "user", content: args });
            
            const mistralResponse = await callMistralAPI(messages, 2000, 0.75);
            
            if (mistralResponse) {
                addToMemory(String(senderId), 'user', args);
                addToMemory(String(senderId), 'assistant', mistralResponse);
                log.info(`🔄 Mistral fallback pour ${senderId}: ${args.substring(0, 30)}...`);
                return mistralResponse;
            }
            
            throw new Error('Mistral aussi en échec');
            
        } catch (mistralError) {
            log.error(`❌ Erreur totale conversation ${senderId}: Gemini(${geminiError.message}) + Mistral(${mistralError.message})`);
            
            const errorResponse = "🤔 J'ai rencontré une petite difficulté technique. Peux-tu reformuler ta demande différemment ? 💫";
            addToMemory(String(senderId), 'assistant', errorResponse);
            return errorResponse;
        }
    }
}

// ✅ Détection des demandes de contact admin (optimisée)
function detectContactAdminIntention(message) {
    const lowerMessage = message.toLowerCase();
    
    const contactPatterns = [
        { patterns: [/(?:contacter|parler|écrire).*?(?:admin|administrateur|créateur|durand)/i], reason: 'contact_direct' },
        { patterns: [/(?:problème|bug|erreur).*?(?:grave|urgent|important)/i], reason: 'probleme_technique' },
        { patterns: [/(?:signaler|reporter|dénoncer)/i], reason: 'signalement' },
        { patterns: [/(?:suggestion|propose|idée).*?(?:amélioration|nouvelle)/i], reason: 'suggestion' },
        { patterns: [/(?:qui a créé|créateur|développeur).*?(?:bot|nakamabot)/i], reason: 'question_creation' },
        { patterns: [/(?:plainte|réclamation|pas content|mécontent)/i], reason: 'plainte' }
    ];
    
    for (const category of contactPatterns) {
        for (const pattern of category.patterns) {
            if (pattern.test(message)) {
                if (category.reason === 'question_creation') {
                    return { shouldContact: false }; // Géré par l'IA
                }
                return {
                    shouldContact: true,
                    reason: category.reason,
                    extractedMessage: message
                };
            }
        }
    }
    
    return { shouldContact: false };
}

// ✅ Génération suggestion de contact (optimisée)
function generateContactSuggestion(reason, extractedMessage) {
    const reasonMessages = {
        'contact_direct': { title: "💌 **Contact Admin**", message: "Je vois que tu veux contacter les administrateurs !" },
        'probleme_technique': { title: "🔧 **Problème Technique**", message: "Problème technique détecté !" },
        'signalement': { title: "🚨 **Signalement**", message: "Tu veux signaler quelque chose d'important !" },
        'suggestion': { title: "💡 **Suggestion**", message: "Tu as une suggestion d'amélioration !" },
        'plainte': { title: "📝 **Réclamation**", message: "Tu as une réclamation à formuler !" }
    };
    
    const reasonData = reasonMessages[reason] || {
        title: "📞 **Contact Admin**",
        message: "Il semble que tu aies besoin de contacter les administrateurs !"
    };
    
    const preview = extractedMessage.length > 60 ? extractedMessage.substring(0, 60) + "..." : extractedMessage;
    
    return `${reasonData.title}\n\n${reasonData.message}\n\n💡 **Solution :** Utilise \`/contact [ton message]\` pour les contacter directement.\n\n📝 **Ton message :** "${preview}"\n\n⚡ **Limite :** 2 messages par jour\n📨 Tu recevras une réponse personnalisée !\n\n💕 En attendant, je peux t'aider avec d'autres choses ! Tape /help pour voir mes fonctionnalités !`;
}

// ✅ Détection des intentions de commandes (optimisée avec clans complets)
async function detectCommandIntentions(message, ctx) {
    const quickPatterns = [
        // Images
        { patterns: [/(?:cr[ée]|g[ée]n[ée]r|fai|dessine).*?(?:image|photo|picture)/i, /(?:image|photo|picture).*?(?:de|d'|du|des)/i], command: 'image' },
        { patterns: [/(?:anime|manga|otaku).*?(?:style|version|transform)/i, /transform.*?anime/i], command: 'anime' },
        { patterns: [/(?:analys|d[ée]cri|regarde|voir|examine).*?(?:image|photo)/i, /que.*?(?:voir|vois)/i], command: 'vision' },
        
        // Musique
        { patterns: [/(?:[ée]coute|musique|chanson|son).*?(?:youtube|video)/i, /(?:trouve|cherche).*?(?:musique|chanson)/i], command: 'music' },
        
        // Contact
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
        
        // Autres commandes
        { patterns: [/(?:niveau|level|rang|rank|exp[ée]rience|xp)/i, /(?:voir|montre).*?(?:rang|level)/i], command: 'rank' },
        { patterns: [/(?:stat|statistique|info|donn[ée]e).*?(?:bot|serveur)/i], command: 'stats' },
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

// ✅ Exécution de commande depuis le chat (optimisée)
async function executeCommandFromChat(senderId, commandName, args, ctx) {
    try {
        const COMMANDS = global.COMMANDS || new Map();
        
        if (!COMMANDS.has(commandName)) {
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
        } else {
            const commandFunction = COMMANDS.get(commandName);
            const result = await commandFunction(senderId, args, ctx);
            return { success: true, result };
        }
        
        return { success: false, error: `Commande ${commandName} non trouvée` };
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ✅ Génération de réponse contextuelle (optimisée)
async function generateContextualResponse(originalMessage, commandResult, commandName, ctx) {
    if (typeof commandResult === 'object' && commandResult.type === 'image') {
        return commandResult;
    }
    
    try {
        // Essayer d'abord avec Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const contextPrompt = `L'utilisateur a dit: "${originalMessage}"
J'ai exécuté /${commandName} avec résultat: "${commandResult}"

Génère une réponse naturelle et amicale (max 200 chars) qui présente le résultat de manière conversationnelle.`;

        const result = await model.generateContent(contextPrompt);
        return result.response.text() || commandResult;
        
    } catch (error) {
        // Fallback sur Mistral si besoin
        const { callMistralAPI } = ctx;
        try {
            const response = await callMistralAPI([
                { role: "system", content: "Réponds naturellement et amicalement." },
                { role: "user", content: `Utilisateur: "${originalMessage}"\nRésultat: "${commandResult}"\nPrésente ce résultat naturellement (max 200 chars)` }
            ], 200, 0.7);
            
            return response || commandResult;
        } catch (mistralError) {
            return commandResult;
        }
    }
}

// ✅ Exports pour autres commandes
module.exports.detectCommandIntentions = detectCommandIntentions;
module.exports.executeCommandFromChat = executeCommandFromChat;
module.exports.detectContactAdminIntention = detectContactAdminIntention;
