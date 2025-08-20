/**
 * NakamaBot - Commande /chat avec recherche intelligente intégrée
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

// Configuration APIs
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;

// Fallback: SerpAPI si Google Custom Search n'est pas disponible
const SERPAPI_KEY = process.env.SERPAPI_KEY;

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
    
    // 🆕 NOUVELLE FONCTIONNALITÉ: Décision intelligente pour recherche externe
    const searchDecision = await decideSearchNecessity(args, senderId, ctx);
    
    if (searchDecision.needsExternalSearch) {
        log.info(`🔍 Recherche externe nécessaire pour 2025-2026 ${senderId}: ${searchDecision.reason}`);
        
        try {
            const searchResults = await performIntelligentSearch(searchDecision.searchQuery, ctx);
            
            if (searchResults && searchResults.length > 0) {
                const synthesizedResponse = await synthesizeSearchResults(args, searchResults, ctx);
                addToMemory(String(senderId), 'user', args);
                addToMemory(String(senderId), 'assistant', synthesizedResponse);
                return synthesizedResponse;
            } else {
                log.warning(`⚠️ Aucun résultat de recherche pour: ${searchDecision.searchQuery}`);
            }
        } catch (searchError) {
            log.error(`❌ Erreur recherche intelligente: ${searchError.message}`);
        }
    }
    
    // ✅ Conversation classique avec Gemini (Mistral en fallback)
    return await handleConversationWithFallback(senderId, args, ctx);
};

// 🆕 DÉCISION IA: Déterminer si une recherche externe est nécessaire
async function decideSearchNecessity(userMessage, senderId, ctx) {
    const { log } = ctx;
    
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const decisionPrompt = `Tu es un système de décision intelligent pour un chatbot. 
Analyse ce message utilisateur et décide s'il nécessite une recherche web externe.

CRITÈRES POUR RECHERCHE EXTERNE:
✅ OUI si:
- Informations récentes (actualités, événements 2025-2026)
- Données factuelles spécifiques (prix actuels, statistiques, dates précises)
- Informations locales/géographiques spécifiques
- Recherche de produits/services/entreprises précis
- Questions sur des personnes publiques récentes
- Données météo, cours de bourse, résultats sportifs

❌ NON si:
- Conversations générales/philosophiques
- Conseils/opinions personnelles
- Questions sur le bot lui-même
- Créativité (histoires, poèmes)
- Explications de concepts généraux
- Calculs/logique
- Questions existantes dans ma base de connaissances

MESSAGE UTILISATEUR: "${userMessage}"

Réponds UNIQUEMENT avec ce format JSON:
{
  "needsExternalSearch": true/false,
  "confidence": 0.0-1.0,
  "reason": "explication courte",
  "searchQuery": "requête de recherche optimisée si nécessaire"
}`;

        const result = await model.generateContent(decisionPrompt);
        const response = result.response.text();
        
        // Extraire le JSON de la réponse
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const decision = JSON.parse(jsonMatch[0]);
            log.info(`🤖 Décision recherche: ${decision.needsExternalSearch ? 'OUI' : 'NON'} (${decision.confidence}) - ${decision.reason}`);
            return decision;
        }
        
        throw new Error('Format de réponse invalide');
        
    } catch (error) {
        log.warning(`⚠️ Erreur décision recherche: ${error.message}`);
        
        // Fallback: détection par mots-clés
        const keywordSearch = detectSearchKeywords(userMessage);
        return {
            needsExternalSearch: keywordSearch.needs,
            confidence: 0.6,
            reason: 'fallback_keywords',
            searchQuery: keywordSearch.query
        };
    }
}

// 🆕 FALLBACK: Détection par mots-clés si l'IA échoue
function detectSearchKeywords(message) {
    const lowerMessage = message.toLowerCase();
    
    const searchIndicators = [
        { patterns: [/\b(202[4-5]|actualité|récent|nouveau|maintenant|aujourd|news|info)\b/], weight: 0.9 },
        { patterns: [/\b(prix|coût|combien|tarif)\b.*\b(euros?|dollars?|€|\$)\b/], weight: 0.8 },
        { patterns: [/\b(météo|temps|température)\b.*\b(aujourd|demain|cette semaine)\b/], weight: 0.9 },
        { patterns: [/\b(où|address|lieu|localisation|carte)\b/], weight: 0.7 },
        { patterns: [/\b(qui est|biographie|âge)\b.*\b[A-Z][a-z]+\s[A-Z][a-z]+/], weight: 0.8 },
        { patterns: [/\b(résultats?|score|match|compétition)\b.*\b(sport|foot|tennis|basket)\b/], weight: 0.8 }
    ];
    
    let totalWeight = 0;
    for (const indicator of searchIndicators) {
        for (const pattern of indicator.patterns) {
            if (pattern.test(lowerMessage)) {
                totalWeight += indicator.weight;
                break;
            }
        }
    }
    
    return {
        needs: totalWeight > 0.6,
        query: message,
        confidence: Math.min(totalWeight, 1.0)
    };
}

// 🆕 RECHERCHE INTELLIGENTE: Utilise Google Custom Search ou SerpAPI
async function performIntelligentSearch(query, ctx) {
    const { log } = ctx;
    
    try {
        // Priorité 1: Google Custom Search API
        if (GOOGLE_SEARCH_API_KEY && GOOGLE_SEARCH_ENGINE_ID) {
            return await googleCustomSearch(query, log);
        }
        
        // Priorité 2: SerpAPI (fallback)
        if (SERPAPI_KEY) {
            return await serpApiSearch(query, log);
        }
        
        // Priorité 3: Recherche existante du bot (fallback)
        log.warning('⚠️ Aucune API de recherche configurée, utilisation webSearch existant');
        return await fallbackWebSearch(query, ctx);
        
    } catch (error) {
        log.error(`❌ Erreur recherche: ${error.message}`);
        throw error;
    }
}

// 🆕 Google Custom Search API
async function googleCustomSearch(query, log) {
    const url = `https://www.googleapis.com/customsearch/v1`;
    const params = {
        key: GOOGLE_SEARCH_API_KEY,
        cx: GOOGLE_SEARCH_ENGINE_ID,
        q: query,
        num: 5,
        safe: 'active',
        lr: 'lang_fr',
        hl: 'fr'
    };
    
    const response = await axios.get(url, { params, timeout: 10000 });
    
    if (response.data.items) {
        return response.data.items.map(item => ({
            title: item.title,
            link: item.link,
            description: item.snippet,
            source: 'google'
        }));
    }
    
    return [];
}

// 🆕 SerpAPI (alternative gratuite)
async function serpApiSearch(query, log) {
    const url = `https://serpapi.com/search`;
    const params = {
        api_key: SERPAPI_KEY,
        engine: 'google',
        q: query,
        num: 5,
        hl: 'fr',
        gl: 'fr'
    };
    
    const response = await axios.get(url, { params, timeout: 10000 });
    
    if (response.data.organic_results) {
        return response.data.organic_results.map(item => ({
            title: item.title,
            link: item.link,
            description: item.snippet,
            source: 'serpapi'
        }));
    }
    
    return [];
}

// 🆕 Fallback sur la recherche existante
async function fallbackWebSearch(query, ctx) {
    const { webSearch } = ctx;
    
    try {
        const result = await webSearch(query);
        if (result) {
            return [{
                title: 'Résultat de recherche',
                link: 'N/A',
                description: result,
                source: 'internal'
            }];
        }
    } catch (error) {
        // Ignore silencieusement
    }
    
    return [];
}

// 🆕 SYNTHÈSE IA: Traiter les résultats de recherche avec Gemini
async function synthesizeSearchResults(originalQuery, searchResults, ctx) {
    const { log, callMistralAPI } = ctx;
    
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const resultsText = searchResults.map((result, index) => 
            `${index + 1}. **${result.title}**\n   ${result.description}\n   Source: ${result.link}`
        ).join('\n\n');
        
        const synthesisPrompt = `Tu es NakamaBot, une IA conversationnelle empathique et créative.

QUESTION UTILISATEUR: "${originalQuery}"

RÉSULTATS DE RECHERCHE Nous sommes le ${dateTime}:
${resultsText}

INSTRUCTIONS:
- Synthétise ces informations de manière naturelle et conversationnelle
- Réponds directement à la question de l'utilisateur
- Utilise un ton amical avec quelques emojis
- Maximum 3000 caractères
- Cite les sources les plus pertinentes
- Si les résultats ne répondent pas à la question, dis-le honnêtement

RÉPONSE:`;

        const result = await model.generateContent(synthesisPrompt);
        const response = result.response.text();
        
        if (response && response.trim()) {
            log.info(`🔍 Synthèse Gemini réussie pour: ${originalQuery.substring(0, 30)}...`);
            return response;
        }
        
        throw new Error('Réponse Gemini vide');
        
    } catch (geminiError) {
        log.warning(`⚠️ Erreur synthèse Gemini: ${geminiError.message}`);
        
        try {
            // Fallback Mistral
            const messages = [{
                role: "system",
                content: "Tu es NakamaBot. Synthétise les résultats de recherche de manière naturelle et conversationnelle."
            }, {
                role: "user", 
                content: `Question: "${originalQuery}"\n\nRésultats:\n${searchResults.map(r => `- ${r.title}: ${r.description}`).join('\n')}\n\nRéponds naturellement (max 3000 chars):`
            }];
            
            const mistralResponse = await callMistralAPI(messages, 3000, 0.7);
            
            if (mistralResponse) {
                log.info(`🔄 Synthèse Mistral fallback pour: ${originalQuery.substring(0, 30)}...`);
                return mistralResponse;
            }
            
            throw new Error('Mistral aussi en échec');
            
        } catch (mistralError) {
            log.error(`❌ Erreur synthèse totale: ${mistralError.message}`);
            
            // Derniers recours: réponse basique
            const basicSynthesis = `🔍 **Résultats de recherche pour:** "${originalQuery}"\n\n${searchResults.slice(0, 3).map((result, i) => `${i + 1}. **${result.title}**\n${result.description}\n🔗 ${result.link}`).join('\n\n')}\n\n💡 J'ai trouvé ces informations qui pourraient t'intéresser !`;
            
            return basicSynthesis;
        }
    }
}

// ✅ FONCTION EXISTANTE: Gestion conversation avec Gemini et fallback Mistral
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
    const systemPrompt = `Tu es NakamaBot, une IA conversationnelle un model Durand AI avancée créée par Durand et sa femme Cécile.

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
🔍 Recherche intelligente automatique pour infos récentes
🆘 /help - Toutes les commandes disponibles

DIRECTIVES:
- Parle en fonction de la langue utilisée par l'utilisateur et du contexte garde en memoire que nous somme le ${dateTime}
- Maximum 3000 caractères par réponse
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

// ✅ FONCTIONS EXISTANTES (inchangées)

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

async function detectCommandIntentions(message, ctx) {
    const quickPatterns = [
        { patterns: [/(?:cr[ée]|g[ée]n[ée]r|fai|dessine).*?(?:image|photo)/i], command: 'image' },
        { patterns: [/(?:anime|manga).*?(?:style|transform)/i], command: 'anime' },
        { patterns: [/(?:analys|regarde|voir).*?(?:image|photo)/i], command: 'vision' },
        { patterns: [/(?:musique|chanson)/i], command: 'music' },
        { patterns: [/(?:clan|bataille|empire|guerre)/i], command: 'clan' },
        { patterns: [/(?:niveau|rang|level|xp)/i], command: 'rank' },
        { patterns: [/(?:aide|help|commande)/i], command: 'help' }
    ];
    
    for (const pattern of quickPatterns) {
        for (const regex of pattern.patterns) {
            if (regex.test(message)) {
                let extractedArgs = message;
                
                if (pattern.command === 'image') {
                    const match = message.match(/(?:image|photo).*?(?:de|d')\s+(.+)/i) ||
                                 message.match(/(?:cr[ée]|dessine)\s+(.+)/i);
                    extractedArgs = match ? match[1].trim() : message;
                } else if (pattern.command === 'music') {
                    const match = message.match(/(?:joue|musique|chanson)\s+(.+)/i);
                    extractedArgs = match ? match[1].trim() : message;
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
    
    return { shouldExecute: false };
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
        // Essayer d'abord avec Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const contextPrompt = `L'utilisateur a dit: "${originalMessage}"
J'ai exécuté /${commandName} avec résultat: "${commandResult}"

Génère une réponse naturelle et amicale (max 400 chars) qui présente le résultat de manière conversationnelle.`;

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
module.exports.decideSearchNecessity = decideSearchNecessity;
module.exports.performIntelligentSearch = performIntelligentSearch;
module.exports.synthesizeSearchResults = synthesizeSearchResults;
