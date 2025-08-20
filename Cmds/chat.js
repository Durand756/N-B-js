/**
 * NakamaBot - Commande /chat avec IA pure pour détection intelligente
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

// Configuration APIs - Support de clés multiples pour Gemini
const GEMINI_API_KEYS = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.split(',').map(key => key.trim()) : [];
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;
const SERPAPI_KEY = process.env.SERPAPI_KEY;

// Gestion rotation des clés Gemini
let currentGeminiKeyIndex = 0;

function getNextGeminiAPI() {
    if (GEMINI_API_KEYS.length === 0) {
        throw new Error('Aucune clé Gemini configurée');
    }
    
    const apiKey = GEMINI_API_KEYS[currentGeminiKeyIndex];
    currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % GEMINI_API_KEYS.length;
    
    return new GoogleGenerativeAI(apiKey);
}

module.exports = async function cmdChat(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, log } = ctx;
    
    if (!args.trim()) {
        return "💬 Salut je suis NakamaBot! Je suis là pour toi ! Dis-moi ce qui t'intéresse et on va avoir une conversation géniale ! ✨";
    }
    
    // ✅ Détection contact admin (conservée car spécifique)
    const contactIntention = await detectContactAdminIntention(args, ctx);
    if (contactIntention.shouldContact) {
        log.info(`📞 Intention contact admin détectée pour ${senderId}: ${contactIntention.reason}`);
        const contactSuggestion = generateContactSuggestion(contactIntention.reason, contactIntention.extractedMessage);
        addToMemory(String(senderId), 'user', args);
        addToMemory(String(senderId), 'assistant', contactSuggestion);
        return contactSuggestion;
    }
    
    // 🤖 ANALYSE IA COMPLÈTE DU MESSAGE
    const aiAnalysis = await performCompleteAIAnalysis(args, senderId, ctx);
    
    // 🎯 Exécution de commande détectée
    if (aiAnalysis.commandDetected && aiAnalysis.shouldExecuteCommand) {
        log.info(`🎯 Commande IA détectée: ${aiAnalysis.detectedCommand} (confiance: ${aiAnalysis.commandConfidence}) pour ${senderId}`);
        
        try {
            const commandResult = await executeCommandFromChat(senderId, aiAnalysis.detectedCommand, aiAnalysis.extractedArgs, ctx);
            
            if (commandResult.success) {
                // Gestion spéciale pour les images
                if (typeof commandResult.result === 'object' && commandResult.result.type === 'image') {
                    addToMemory(String(senderId), 'user', args);
                    return commandResult.result;
                }
                
                // Réponse contextuelle naturelle
                const contextualResponse = await generateContextualResponse(args, commandResult.result, aiAnalysis.detectedCommand, ctx);
                addToMemory(String(senderId), 'user', args);
                addToMemory(String(senderId), 'assistant', contextualResponse);
                return contextualResponse;
            } else {
                log.warning(`⚠️ Échec exécution commande ${aiAnalysis.detectedCommand}: ${commandResult.error}`);
            }
        } catch (error) {
            log.error(`❌ Erreur exécution commande intelligente: ${error.message}`);
        }
    }
    
    // 🔍 Recherche externe si nécessaire
    if (aiAnalysis.needsExternalSearch && aiAnalysis.shouldPerformSearch) {
        log.info(`🔍 Recherche externe IA requise pour ${senderId}: ${aiAnalysis.searchReason}`);
        
        try {
            const searchResults = await performIntelligentSearch(aiAnalysis.optimizedSearchQuery, ctx);
            
            if (searchResults && searchResults.length > 0) {
                const naturalResponse = await generateNaturalResponse(args, searchResults, ctx);
                if (naturalResponse) {
                    addToMemory(String(senderId), 'user', args);
                    addToMemory(String(senderId), 'assistant', naturalResponse);
                    return naturalResponse;
                }
            } else {
                log.warning(`⚠️ Aucun résultat de recherche pour: ${aiAnalysis.optimizedSearchQuery}`);
            }
        } catch (searchError) {
            log.error(`❌ Erreur recherche intelligente: ${searchError.message}`);
        }
    }
    
    // 💬 Conversation classique avec Gemini (Mistral en fallback)
    return await handleConversationWithFallback(senderId, args, ctx);
};

// 🧠 ANALYSE IA COMPLÈTE - Tout en une seule passe
async function performCompleteAIAnalysis(userMessage, senderId, ctx) {
    const { log } = ctx;
    
    try {
        const genAI = getNextGeminiAPI();
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
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
        
        const analysisPrompt = `Tu es le système d'analyse intelligent de NakamaBot. Analyse ce message utilisateur pour déterminer les actions nécessaires.

CONTEXTE TEMPOREL: ${dateTime}

COMMANDES DISPONIBLES:
- help: Afficher l'aide et toutes les commandes
- image: Créer des images uniques avec l'IA
- vision: Analyser des images avec précision  
- anime: Transformer images en style anime/manga
- music: Trouver musique sur YouTube
- clan: Système de clans et batailles
- rank: Voir niveau et progression
- contact: Contacter les administrateurs
- weather: Informations météo actuelles

MESSAGE UTILISATEUR: "${userMessage}"

ANALYSE REQUISE:

1. DÉTECTION DE COMMANDE:
   - L'utilisateur veut-il utiliser une fonctionnalité spécifique ?
   - Quelle commande correspond à son intention ?
   - Quels sont les arguments à extraire ?

2. NÉCESSITÉ DE RECHERCHE EXTERNE:
   - Le message nécessite-t-il des informations récentes/actuelles ?
   - S'agit-il de données factuelles spécifiques non connues ?
   - Quelle requête de recherche serait optimale ?

3. TYPE DE RÉPONSE ATTENDUE:
   - Conversation générale
   - Exécution de commande
   - Recherche d'informations
   - Aide/support

Réponds UNIQUEMENT avec ce JSON structuré:
{
  "analysisType": "command|search|conversation|help",
  "commandDetected": true/false,
  "detectedCommand": "nom_commande_ou_null",
  "commandConfidence": 0.0-1.0,
  "shouldExecuteCommand": true/false,
  "extractedArgs": "arguments_extraits_ou_message_complet",
  "needsExternalSearch": true/false,
  "shouldPerformSearch": true/false,
  "searchConfidence": 0.0-1.0,
  "searchReason": "pourquoi_recherche_necessaire",
  "optimizedSearchQuery": "requete_optimisee",
  "conversationType": "general|technical|creative|support",
  "userIntent": "description_intention_utilisateur",
  "reasoning": "explication_courte_du_raisonnement"
}`;

        const result = await model.generateContent(analysisPrompt);
        const response = result.response.text();
        
        // Extraire le JSON de la réponse
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const analysis = JSON.parse(jsonMatch[0]);
            
            log.info(`🧠 Analyse IA complète: ${analysis.analysisType} | Commande: ${analysis.detectedCommand || 'aucune'} | Recherche: ${analysis.needsExternalSearch ? 'oui' : 'non'}`);
            
            return {
                ...analysis,
                // Valeurs par défaut pour éviter les erreurs
                commandDetected: analysis.commandDetected || false,
                shouldExecuteCommand: analysis.shouldExecuteCommand || false,
                needsExternalSearch: analysis.needsExternalSearch || false,
                shouldPerformSearch: analysis.shouldPerformSearch || false,
                commandConfidence: analysis.commandConfidence || 0,
                searchConfidence: analysis.searchConfidence || 0
            };
        }
        
        throw new Error('Format JSON invalide');
        
    } catch (error) {
        log.warning(`⚠️ Erreur analyse IA complète: ${error.message}`);
        
        // Fallback minimal
        return {
            analysisType: 'conversation',
            commandDetected: false,
            shouldExecuteCommand: false,
            needsExternalSearch: false,
            shouldPerformSearch: false,
            conversationType: 'general',
            userIntent: 'conversation_generale',
            reasoning: 'fallback_error'
        };
    }
}

// 🔍 RECHERCHE INTELLIGENTE - Inchangée mais simplifiée
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
        
        log.warning('⚠️ Aucune API de recherche configurée');
        return [];
        
    } catch (error) {
        log.error(`❌ Erreur recherche: ${error.message}`);
        return [];
    }
}

// Google Custom Search API
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

// SerpAPI (alternative)
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

// 🎭 GÉNÉRATION DE RÉPONSE NATURELLE (avec recherche)
async function generateNaturalResponse(originalQuery, searchResults, ctx) {
    const { log, callMistralAPI } = ctx;
    
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
    
    try {
        const genAI = getNextGeminiAPI();
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const resultsText = searchResults.map((result, index) => 
            `${result.title}: ${result.description}`
        ).join('\n');
        
        const naturalPrompt = `Tu es NakamaBot, une IA conversationnelle empathique et créative.

CONTEXTE TEMPOREL: ${dateTime}

L'utilisateur te demande: "${originalQuery}"

Informations actuelles pertinentes:
${resultsText}

INSTRUCTIONS:
- Réponds comme si tu connaissais naturellement ces informations
- Ton conversationnel et amical avec quelques emojis
- Maximum 2500 caractères
- Ne mentionne JAMAIS que tu as fait une recherche
- Ne dis jamais "d'après mes recherches" ou "selon les sources"  
- Réponds comme dans une conversation normale entre amis
- Si l'information n'est pas complète, reste naturel et honnête

RÉPONSE NATURELLE:`;

        const result = await model.generateContent(naturalPrompt);
        const response = result.response.text();
        
        if (response && response.trim()) {
            log.info(`🎭 Réponse naturelle Gemini générée`);
            return response;
        }
        
        throw new Error('Réponse Gemini vide');
        
    } catch (geminiError) {
        log.warning(`⚠️ Erreur réponse naturelle Gemini: ${geminiError.message}`);
        
        try {
            // Fallback Mistral
            const messages = [{
                role: "system",
                content: "Tu es NakamaBot. Réponds naturellement comme dans une conversation normale. Ne mentionne jamais de recherches ou sources."
            }, {
                role: "user", 
                content: `Question: "${originalQuery}"\n\nInformations utiles:\n${searchResults.map(r => `${r.title}: ${r.description}`).join('\n')}\n\nRéponds naturellement comme si tu connaissais déjà ces infos (max 2500 chars):`
            }];
            
            const mistralResponse = await callMistralAPI(messages, 2500, 0.7);
            
            if (mistralResponse) {
                log.info(`🔄 Réponse naturelle Mistral générée`);
                return mistralResponse;
            }
            
            throw new Error('Mistral aussi en échec');
            
        } catch (mistralError) {
            log.error(`❌ Erreur réponse naturelle totale: ${mistralError.message}`);
            
            // Derniers recours
            const topResult = searchResults[0];
            if (topResult) {
                return `D'après ce que je sais, ${topResult.description} 💡 ${searchResults.length > 1 ? 'Il y a aussi d\'autres aspects intéressants sur le sujet !' : 'J\'espère que ça répond à ta question !'}`;
            }
            
            return null;
        }
    }
}

// 💬 CONVERSATION NORMALE (avec rotation Gemini)
async function handleConversationWithFallback(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, callMistralAPI, log } = ctx;
    
    // Contexte optimisé (8 derniers messages)
    const context = getMemoryContext(String(senderId)).slice(-8);
    const messageCount = context.filter(msg => msg.role === 'user').length;
    
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
    
    // Construction historique conversation
    let conversationHistory = "";
    if (context.length > 0) {
        conversationHistory = context.map(msg => 
            `${msg.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${msg.content}`
        ).join('\n') + '\n';
    }
    
    // Prompt système optimisé
    const systemPrompt = `Tu es NakamaBot, une IA conversationnelle avancée créée par Durand et Cécile.

CONTEXTE TEMPOREL: ${dateTime}

INTELLIGENCE & PERSONNALITÉ:
- Empathique, créative et intuitive
- Comprends les émotions et intentions sous-jacentes  
- Pédagogue naturelle qui explique clairement
- Adaptable selon l'utilisateur et le contexte

CAPACITÉS PRINCIPALES:
🎨 Création d'images intelligente (dis "dessine-moi..." ou "crée une image de...")
👁️ Analyse d'images avancée (dis "regarde cette image" ou "que vois-tu ?")
🌸 Transformation anime/manga (dis "transforme en anime" ou "style manga")
🎵 Recherche musicale YouTube (dis "joue..." ou "trouve la musique...")
🛡️ Système de clans et batailles (dis "clan" ou "bataille")
📊 Progression et niveau (dis "mon niveau" ou "mes stats")
📞 Contact admin (dis "contacter admin" ou utilise /contact)
🔍 Recherche intelligente automatique pour infos récentes
🆘 Guide complet (dis "aide" ou "que peux-tu faire ?")

DIRECTIVES:
- Parle en fonction de la langue utilisée par l'utilisateur
- Maximum 3000 caractères par réponse
- Utilise quelques emojis avec parcimonie
- Évite les répétitions et formules toutes faites
- ${messageCount >= 5 ? 'Suggère /help si pertinent' : ''}
- Pour questions techniques: "Demande à Durand ou Cécile, ils connaissent tous mes secrets !"
- Recommande /contact pour problèmes techniques graves

${conversationHistory ? `Historique:\n${conversationHistory}` : ''}

Utilisateur: ${args}`;

    try {
        // Essayer avec Gemini (rotation automatique)
        const genAI = getNextGeminiAPI();
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(systemPrompt);
        const geminiResponse = result.response.text();
        
        if (geminiResponse && geminiResponse.trim()) {
            addToMemory(String(senderId), 'user', args);
            addToMemory(String(senderId), 'assistant', geminiResponse);
            log.info(`💎 Gemini réponse (clé ${currentGeminiKeyIndex}) pour ${senderId}`);
            return geminiResponse;
        }
        
        throw new Error('Réponse Gemini vide');
        
    } catch (geminiError) {
        log.warning(`⚠️ Gemini échec (clé ${currentGeminiKeyIndex}) pour ${senderId}: ${geminiError.message}`);
        
        try {
            // Fallback Mistral
            const messages = [{ role: "system", content: systemPrompt }];
            messages.push(...context);
            messages.push({ role: "user", content: args });
            
            const mistralResponse = await callMistralAPI(messages, 2000, 0.75);
            
            if (mistralResponse) {
                addToMemory(String(senderId), 'user', args);
                addToMemory(String(senderId), 'assistant', mistralResponse);
                log.info(`🔄 Mistral fallback pour ${senderId}`);
                return mistralResponse;
            }
            
            throw new Error('Mistral aussi en échec');
            
        } catch (mistralError) {
            log.error(`❌ Erreur totale conversation ${senderId}: Gemini + Mistral`);
            
            const errorResponse = "🤔 J'ai rencontré une petite difficulté technique. Peux-tu reformuler ta demande différemment ? 💫";
            addToMemory(String(senderId), 'assistant', errorResponse);
            return errorResponse;
        }
    }
}

// ✅ FONCTIONS UTILITAIRES (conservées et simplifiées)

async function detectContactAdminIntention(message, ctx) {
    const { log } = ctx;
    
    try {
        const genAI = getNextGeminiAPI();
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const contactPrompt = `Analyse ce message pour déterminer si l'utilisateur veut contacter les administrateurs.

MESSAGE: "${message}"

CRITÈRES CONTACT ADMIN:
✅ Demande explicite de contact admin/créateurs
✅ Problème technique grave/urgent  
✅ Signalement important
✅ Suggestion d'amélioration
✅ Réclamation/plainte

❌ Questions générales sur le bot
❌ Conversation normale
❌ Questions sur création (géré par IA)

Réponds UNIQUEMENT:
{
  "shouldContact": true/false,
  "reason": "contact_direct|probleme_technique|signalement|suggestion|plainte|aucun",
  "extractedMessage": "message_original"
}`;

        const result = await model.generateContent(contactPrompt);
        const response = result.response.text();
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const analysis = JSON.parse(jsonMatch[0]);
            return {
                shouldContact: analysis.shouldContact || false,
                reason: analysis.reason || 'aucun',
                extractedMessage: analysis.extractedMessage || message
            };
        }
        
    } catch (error) {
        log.warning(`⚠️ Erreur détection contact admin: ${error.message}`);
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
        const genAI = getNextGeminiAPI();
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const contextPrompt = `L'utilisateur a dit: "${originalMessage}"
J'ai exécuté /${commandName} avec résultat: "${commandResult}"

Génère une réponse naturelle et amicale (max 400 chars) qui présente le résultat de manière conversationnelle.`;

        const result = await model.generateContent(contextPrompt);
        return result.response.text() || commandResult;
        
    } catch (error) {
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
