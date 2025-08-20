/**
 * NakamaBot - Commande /chat avec recherche intelligente intégrée et rotation des clés Gemini
 * VERSION CORRIGÉE - Protection contre les réponses multiples
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

// Configuration APIs avec rotation des clés Gemini
const GEMINI_API_KEYS = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.split(',').map(key => key.trim()) : [];
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;
const SERPAPI_KEY = process.env.SERPAPI_KEY;

// 🛡️ PROTECTION ANTI-DOUBLONS - État global pour éviter les exécutions multiples
const PROCESSING_STATE = new Map();
const PROCESSING_TIMEOUT = 30000; // 30 secondes timeout

// État global pour la rotation des clés
let currentGeminiKeyIndex = 0;
const failedKeys = new Set();

// 🛡️ FONCTION DE PROTECTION PRINCIPALE
function createExecutionLock(senderId) {
    const lockKey = `chat_${senderId}`;
    const now = Date.now();
    
    // Nettoyer les anciens locks expirés
    for (const [key, timestamp] of PROCESSING_STATE.entries()) {
        if (now - timestamp > PROCESSING_TIMEOUT) {
            PROCESSING_STATE.delete(key);
        }
    }
    
    // Vérifier si déjà en cours de traitement
    if (PROCESSING_STATE.has(lockKey)) {
        const timeDiff = now - PROCESSING_STATE.get(lockKey);
        if (timeDiff < PROCESSING_TIMEOUT) {
            return { locked: true, waitTime: Math.ceil((PROCESSING_TIMEOUT - timeDiff) / 1000) };
        }
    }
    
    // Créer le lock
    PROCESSING_STATE.set(lockKey, now);
    return { locked: false };
}

function releaseExecutionLock(senderId) {
    const lockKey = `chat_${senderId}`;
    PROCESSING_STATE.delete(lockKey);
}

// Fonctions de rotation des clés (inchangées mais simplifiées)
function getNextGeminiKey() {
    if (GEMINI_API_KEYS.length === 0) {
        throw new Error('Aucune clé Gemini configurée');
    }
    
    if (failedKeys.size >= GEMINI_API_KEYS.length) {
        failedKeys.clear();
        currentGeminiKeyIndex = 0;
    }
    
    let attempts = 0;
    while (attempts < GEMINI_API_KEYS.length) {
        const key = GEMINI_API_KEYS[currentGeminiKeyIndex];
        currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % GEMINI_API_KEYS.length;
        
        if (!failedKeys.has(key)) {
            return key;
        }
        attempts++;
    }
    
    failedKeys.clear();
    currentGeminiKeyIndex = 0;
    return GEMINI_API_KEYS[0];
}

function markKeyAsFailed(apiKey) {
    failedKeys.add(apiKey);
}

// 🔧 FONCTION GEMINI SIMPLIFIÉE (évite les retry en boucle)
async function callGeminiWithRotation(prompt, maxRetries = 2) {
    let lastError = null;
    
    for (let attempt = 0; attempt < Math.min(maxRetries, GEMINI_API_KEYS.length); attempt++) {
        try {
            const apiKey = getNextGeminiKey();
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            
            const result = await model.generateContent(prompt);
            const response = result.response.text();
            
            if (response && response.trim()) {
                failedKeys.delete(apiKey);
                return response;
            }
            
            throw new Error('Réponse Gemini vide');
            
        } catch (error) {
            lastError = error;
            
            if (error.message.includes('API_KEY') || error.message.includes('quota') || error.message.includes('limit')) {
                const currentKey = GEMINI_API_KEYS[(currentGeminiKeyIndex - 1 + GEMINI_API_KEYS.length) % GEMINI_API_KEYS.length];
                markKeyAsFailed(currentKey);
            }
            
            // Ne pas continuer si c'est la dernière tentative
            if (attempt === maxRetries - 1) {
                break;
            }
        }
    }
    
    throw lastError || new Error('Toutes les clés Gemini ont échoué');
}

// 🎯 FONCTION PRINCIPALE AVEC PROTECTION ANTI-DOUBLONS
module.exports = async function cmdChat(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, webSearch, log } = ctx;
    
    // 🛡️ PROTECTION 1: Vérifier le lock d'exécution
    const lockStatus = createExecutionLock(senderId);
    if (lockStatus.locked) {
        log.warning(`🔒 Exécution bloquée pour ${senderId} (déjà en cours, attendre ${lockStatus.waitTime}s)`);
        return "⏳ Je traite encore ta demande précédente, patiente quelques secondes...";
    }
    
    try {
        // 🛡️ PROTECTION 2: Messages vides
        if (!args || !args.trim()) {
            return "💬 Salut je suis NakamaBot! Je suis là pour toi ! Dis-moi ce qui t'intéresse et on va avoir une conversation géniale ! ✨";
        }
        
        const normalizedArgs = args.trim();
        
        // 🛡️ PROTECTION 3: Une seule décision de traitement
        let response = null;
        let processingMethod = 'none';
        
        // 📞 ÉTAPE 1: Contact admin (priorité absolue)
        const contactIntention = detectContactAdminIntention(normalizedArgs);
        if (contactIntention.shouldContact) {
            log.info(`📞 Contact admin détecté pour ${senderId}: ${contactIntention.reason}`);
            response = generateContactSuggestion(contactIntention.reason, contactIntention.extractedMessage);
            processingMethod = 'contact_admin';
        }
        
        // 🤖 ÉTAPE 2: Commandes intelligentes (si pas de contact admin)
        if (!response) {
            const intelligentCommand = await detectIntelligentCommands(normalizedArgs, ctx);
            if (intelligentCommand.shouldExecute) {
                log.info(`🧠 Commande IA: /${intelligentCommand.command} (${intelligentCommand.confidence}) pour ${senderId}`);
                
                try {
                    const commandResult = await executeCommandFromChat(senderId, intelligentCommand.command, intelligentCommand.args, ctx);
                    
                    if (commandResult.success) {
                        if (typeof commandResult.result === 'object' && commandResult.result.type === 'image') {
                            addToMemory(String(senderId), 'user', normalizedArgs);
                            return commandResult.result;
                        }
                        
                        response = await generateContextualResponse(normalizedArgs, commandResult.result, intelligentCommand.command, ctx);
                        processingMethod = 'intelligent_command';
                    }
                } catch (error) {
                    log.warning(`⚠️ Erreur commande IA: ${error.message}`);
                    // Continue avec les autres méthodes
                }
            }
        }
        
        // 🔍 ÉTAPE 3: Recherche externe (si pas de commande)
        if (!response) {
            const searchDecision = await decideSearchNecessity(normalizedArgs, senderId, ctx);
            
            if (searchDecision.needsExternalSearch) {
                log.info(`🔍 Recherche externe pour ${senderId}: ${searchDecision.reason}`);
                
                try {
                    const searchResults = await performIntelligentSearch(searchDecision.searchQuery, ctx);
                    
                    if (searchResults && searchResults.length > 0) {
                        response = await generateNaturalResponse(normalizedArgs, searchResults, ctx);
                        processingMethod = 'external_search';
                    }
                } catch (searchError) {
                    log.warning(`⚠️ Erreur recherche: ${searchError.message}`);
                    // Continue avec conversation normale
                }
            }
        }
        
        // 💬 ÉTAPE 4: Conversation normale (fallback final)
        if (!response) {
            response = await handleConversationWithFallback(senderId, normalizedArgs, ctx);
            processingMethod = 'normal_conversation';
        }
        
        // 🛡️ PROTECTION 4: Validation finale de la réponse
        if (!response || typeof response !== 'string' || !response.trim()) {
            response = "🤔 J'ai une petite difficulté à répondre. Peux-tu reformuler ta question ? 💫";
            log.warning(`⚠️ Réponse vide générée pour ${senderId}, fallback appliqué`);
        }
        
        // ✅ MÉMOIRE: Ajouter à l'historique seulement si pas déjà fait
        const context = getMemoryContext(String(senderId));
        const lastUserMessage = context.length > 0 ? context[context.length - 1] : null;
        
        if (!lastUserMessage || lastUserMessage.content !== normalizedArgs || lastUserMessage.role !== 'user') {
            addToMemory(String(senderId), 'user', normalizedArgs);
        }
        
        if (typeof response === 'string') {
            addToMemory(String(senderId), 'assistant', response);
        }
        
        log.info(`✅ Réponse générée pour ${senderId} via ${processingMethod}: ${normalizedArgs.substring(0, 30)}...`);
        return response;
        
    } catch (error) {
        log.error(`❌ Erreur critique cmdChat pour ${senderId}: ${error.message}`);
        return "😅 Désolé, j'ai rencontré un problème technique. Réessaie dans quelques instants !";
        
    } finally {
        // 🛡️ PROTECTION 5: Toujours libérer le lock
        releaseExecutionLock(senderId);
    }
};

// 🔍 FONCTIONS DE DÉCISION SIMPLIFIÉES (évitent les appels multiples)

async function decideSearchNecessity(userMessage, senderId, ctx) {
    const { log } = ctx;
    
    try {
        const decisionPrompt = `Analyse ce message et décide s'il nécessite une recherche web externe.

MESSAGE: "${userMessage}"

CRITÈRES OUI: actualités 2025-2026, prix actuels, météo, informations locales spécifiques
CRITÈRES NON: conversations générales, conseils, questions sur concepts généraux

Réponds UNIQUEMENT:
{"needsExternalSearch": true/false, "confidence": 0.0-1.0, "reason": "explication", "searchQuery": "requête"}`;

        const response = await callGeminiWithRotation(decisionPrompt, 1); // 1 seule tentative
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const decision = JSON.parse(jsonMatch[0]);
            return decision;
        }
        
    } catch (error) {
        log.warning(`⚠️ Erreur décision recherche: ${error.message}`);
    }
    
    // Fallback simple
    return detectSearchKeywords(userMessage);
}

function detectSearchKeywords(message) {
    const lowerMessage = message.toLowerCase();
    const searchIndicators = [
        /\b(202[4-6]|actualité|récent|nouveau|maintenant|aujourd|news|info)\b/,
        /\b(prix|coût|combien|tarif)\b.*\b(euros?|dollars?|€|\$)\b/,
        /\b(météo|temps|température)\b.*\b(aujourd|demain|cette semaine)\b/,
        /\b(où|address|lieu|localisation|carte)\b/
    ];
    
    const needsSearch = searchIndicators.some(pattern => pattern.test(lowerMessage));
    
    return {
        needsExternalSearch: needsSearch,
        confidence: needsSearch ? 0.7 : 0.2,
        reason: 'keyword_fallback',
        searchQuery: message
    };
}

// 🧠 DÉTECTION COMMANDES SIMPLIFIÉE
async function detectIntelligentCommands(message, ctx) {
    const { log } = ctx;
    
    // Fallback rapide par mots-clés d'abord
    const quickDetection = quickCommandDetection(message);
    if (quickDetection.shouldExecute) {
        return quickDetection;
    }
    
    // Détection IA seulement si nécessaire
    try {
        const VALID_COMMANDS = ['help', 'image', 'vision', 'anime', 'music', 'clan', 'rank', 'contact', 'weather'];
        
        const detectionPrompt = `Détecte si ce message demande une commande spécifique du bot.

COMMANDES: ${VALID_COMMANDS.join(', ')}
MESSAGE: "${message}"

Réponds UNIQUEMENT:
{"isCommand": true/false, "command": "nom", "confidence": 0.0-1.0, "extractedArgs": "args"}`;

        const response = await callGeminiWithRotation(detectionPrompt, 1);
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const detection = JSON.parse(jsonMatch[0]);
            
            if (detection.isCommand && detection.confidence >= 0.8) {
                return {
                    shouldExecute: true,
                    command: detection.command,
                    args: detection.extractedArgs,
                    confidence: detection.confidence,
                    method: 'ai'
                };
            }
        }
        
    } catch (error) {
        log.warning(`⚠️ Erreur détection IA: ${error.message}`);
    }
    
    return { shouldExecute: false };
}

// 🚀 DÉTECTION RAPIDE PAR MOTS-CLÉS
function quickCommandDetection(message) {
    const lowerMessage = message.toLowerCase().trim();
    
    const quickPatterns = [
        { command: 'help', patterns: [/^(aide|help|guide|que peux-tu faire)$/] },
        { command: 'image', patterns: [/^dessine(-moi)?\s+/, /^(crée|génère)\s+(une\s+)?(image|dessin)/] },
        { command: 'vision', patterns: [/^regarde\s+(cette\s+)?(image|photo)/, /^(analyse|décris)\s+l?image/] },
        { command: 'music', patterns: [/^(joue|lance|play)\s+/, /^trouve\s+.+\s+youtube/] },
        { command: 'weather', patterns: [/^(météo|quel\s+temps|température)/] }
    ];
    
    for (const { command, patterns } of quickPatterns) {
        if (patterns.some(pattern => pattern.test(lowerMessage))) {
            return {
                shouldExecute: true,
                command: command,
                args: message,
                confidence: 0.9,
                method: 'quick_keyword'
            };
        }
    }
    
    return { shouldExecute: false };
}

// 🔧 FONCTIONS UTILITAIRES SIMPLIFIÉES

async function performIntelligentSearch(query, ctx) {
    const { log } = ctx;
    
    try {
        if (GOOGLE_SEARCH_API_KEY && GOOGLE_SEARCH_ENGINE_ID) {
            return await googleCustomSearch(query, log);
        }
        if (SERPAPI_KEY) {
            return await serpApiSearch(query, log);
        }
        return await fallbackWebSearch(query, ctx);
    } catch (error) {
        log.error(`❌ Erreur recherche: ${error.message}`);
        return [];
    }
}

async function googleCustomSearch(query, log) {
    const url = `https://www.googleapis.com/customsearch/v1`;
    const params = {
        key: GOOGLE_SEARCH_API_KEY,
        cx: GOOGLE_SEARCH_ENGINE_ID,
        q: query,
        num: 3, // Réduit pour éviter les timeouts
        safe: 'active',
        lr: 'lang_fr'
    };
    
    const response = await axios.get(url, { params, timeout: 8000 });
    
    return response.data.items ? response.data.items.map(item => ({
        title: item.title,
        link: item.link,
        description: item.snippet,
        source: 'google'
    })) : [];
}

async function serpApiSearch(query, log) {
    const url = `https://serpapi.com/search`;
    const params = {
        api_key: SERPAPI_KEY,
        engine: 'google',
        q: query,
        num: 3,
        hl: 'fr'
    };
    
    const response = await axios.get(url, { params, timeout: 8000 });
    
    return response.data.organic_results ? response.data.organic_results.map(item => ({
        title: item.title,
        link: item.link,
        description: item.snippet,
        source: 'serpapi'
    })) : [];
}

async function fallbackWebSearch(query, ctx) {
    const { webSearch } = ctx;
    
    try {
        const result = await webSearch(query);
        return result ? [{
            title: 'Information récente',
            description: result,
            source: 'internal'
        }] : [];
    } catch {
        return [];
    }
}

async function generateNaturalResponse(originalQuery, searchResults, ctx) {
    const { callMistralAPI, log } = ctx;
    
    try {
        const resultsText = searchResults.slice(0, 2).map(r => `${r.title}: ${r.description}`).join('\n');
        
        const naturalPrompt = `Tu es NakamaBot. Réponds naturellement à cette question avec ces infos récentes:

Question: "${originalQuery}"
Infos: ${resultsText}

Réponds naturellement comme si tu connaissais ces infos (max 2000 chars, avec quelques emojis):`;

        const response = await callGeminiWithRotation(naturalPrompt, 1);
        return response || generateFallbackResponse(originalQuery, searchResults[0]);
        
    } catch (error) {
        log.warning(`⚠️ Erreur génération naturelle: ${error.message}`);
        return generateFallbackResponse(originalQuery, searchResults[0]);
    }
}

function generateFallbackResponse(query, topResult) {
    if (topResult) {
        return `D'après mes informations, ${topResult.description} 💡 J'espère que ça répond à ta question !`;
    }
    return "🤔 J'ai cherché mais je n'ai pas trouvé d'infos récentes sur ce sujet. Peux-tu reformuler ?";
}

async function handleConversationWithFallback(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, log } = ctx;
    
    // Contexte limité pour éviter les prompts trop longs
    const context = getMemoryContext(String(senderId)).slice(-6);
    
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
    
    const conversationHistory = context.length > 0 ? 
        context.map(msg => `${msg.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${msg.content}`).join('\n') + '\n' : '';
    
    const systemPrompt = `Tu es NakamaBot, une IA conversationnelle créée par Durand et Cécile.

CONTEXTE: ${dateTime}

PERSONNALITÉ: Empathique, créative, pédagogue
CAPACITÉS: Création d'images, analyse d'images, style anime, recherche musicale, clans, progression

${conversationHistory}Utilisateur: ${args}

Réponds naturellement (max 2500 chars, quelques emojis):`;

    try {
        const geminiResponse = await callGeminiWithRotation(systemPrompt, 1);
        
        if (geminiResponse && geminiResponse.trim()) {
            log.info(`💎 Gemini conversation pour ${senderId}`);
            return geminiResponse;
        }
        
        throw new Error('Réponse Gemini vide');
        
    } catch (geminiError) {
        log.warning(`⚠️ Gemini échec: ${geminiError.message}`);
        
        try {
            const messages = [{ role: "system", content: "Tu es NakamaBot. Réponds amicalement et naturellement." }];
            messages.push(...context.slice(-4)); // Encore plus limité pour Mistral
            messages.push({ role: "user", content: args });
            
            const mistralResponse = await callMistralAPI(messages, 1500, 0.7);
            
            if (mistralResponse) {
                log.info(`🔄 Mistral fallback pour ${senderId}`);
                return mistralResponse;
            }
            
        } catch (mistralError) {
            log.error(`❌ Erreur conversation totale: ${mistralError.message}`);
        }
        
        return "🤔 J'ai rencontré une petite difficulté technique. Peux-tu reformuler ta demande ? 💫";
    }
}

// 🛠️ FONCTIONS UTILITAIRES EXISTANTES (simplifiées)

function detectContactAdminIntention(message) {
    const lowerMessage = message.toLowerCase();
    
    const contactPatterns = [
        { pattern: /(?:contacter|parler).*?(?:admin|administrateur|créateur|durand)/i, reason: 'contact_direct' },
        { pattern: /(?:problème|bug|erreur).*?(?:grave|urgent)/i, reason: 'probleme_technique' },
        { pattern: /(?:signaler|reporter)/i, reason: 'signalement' },
        { pattern: /(?:suggestion|amélioration)/i, reason: 'suggestion' }
    ];
    
    for (const { pattern, reason } of contactPatterns) {
        if (pattern.test(message)) {
            return { shouldContact: true, reason, extractedMessage: message };
        }
    }
    
    return { shouldContact: false };
}

function generateContactSuggestion(reason, extractedMessage) {
    const reasonMessages = {
        'contact_direct': "💌 Je vois que tu veux contacter les administrateurs !",
        'probleme_technique': "🔧 Problème technique détecté !",
        'signalement': "🚨 Tu veux signaler quelque chose !",
        'suggestion': "💡 Tu as une suggestion !"
    };
    
    const message = reasonMessages[reason] || "📞 Tu veux contacter les admins !";
    const preview = extractedMessage.length > 60 ? extractedMessage.substring(0, 60) + "..." : extractedMessage;
    
    return `${message}\n\n💡 **Solution :** Utilise \`/contact [ton message]\`\n\n📝 **Aperçu :** "${preview}"\n\n⚡ Limite : 2 messages/jour\n💕 En attendant, je peux t'aider ! Tape /help`;
}

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

async function generateContextualResponse(originalMessage, commandResult, commandName, ctx) {
    if (typeof commandResult === 'object' && commandResult.type === 'image') {
        return commandResult;
    }
    
    try {
        const contextPrompt = `L'utilisateur a dit: "${originalMessage}"
Résultat de /${commandName}: "${commandResult}"

Présente ce résultat naturellement (max 300 chars):`;

        const response = await callGeminiWithRotation(contextPrompt, 1);
        return response && response.trim() ? response : commandResult;
        
    } catch (error) {
        return commandResult;
    }
}

// ✅ Exports pour compatibilité
module.exports.detectIntelligentCommands = detectIntelligentCommands;
module.exports.executeCommandFromChat = executeCommandFromChat;
module.exports.detectContactAdminIntention = detectContactAdminIntention;
module.exports.callGeminiWithRotation = callGeminiWithRotation;
