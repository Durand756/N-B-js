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
    
    // 🆕 DÉTECTION INTELLIGENTE DES COMMANDES (Nouveau Système)
    const intelligentCommand = await detectIntelligentCommands(args, ctx);
    if (intelligentCommand.shouldExecute) {
        log.info(`🎯 Commande intelligente détectée: ${intelligentCommand.command} (${intelligentCommand.confidence}) via ${intelligentCommand.method} pour ${senderId}`);
        
        try {
            const commandResult = await executeCommandFromChat(senderId, intelligentCommand.command, intelligentCommand.args, ctx);
            
            if (commandResult.success) {
                // Gestion spéciale pour les images
                if (typeof commandResult.result === 'object' && commandResult.result.type === 'image') {
                    addToMemory(String(senderId), 'user', args);
                    return commandResult.result;
                }
                
                // Réponse contextuelle naturelle
                const contextualResponse = await generateContextualResponse(args, commandResult.result, intelligentCommand.command, ctx);
                addToMemory(String(senderId), 'user', args);
                addToMemory(String(senderId), 'assistant', contextualResponse);
                return contextualResponse;
            } else {
                log.warning(`⚠️ Échec exécution commande ${intelligentCommand.command}: ${commandResult.error}`);
                // Continue avec conversation normale en cas d'échec
            }
        } catch (error) {
            log.error(`❌ Erreur exécution commande intelligente: ${error.message}`);
            // Continue avec conversation normale en cas d'erreur
        }
    } 
    
    // 🆕 NOUVELLE FONCTIONNALITÉ: Décision intelligente pour recherche externe
    const searchDecision = await decideSearchNecessity(args, senderId, ctx);
    
    if (searchDecision.needsExternalSearch) {
        log.info(`🔍 Recherche externe nécessaire pour 2025-2026 ${senderId}: ${searchDecision.reason}`);
        
        try {
            const searchResults = await performIntelligentSearch(searchDecision.searchQuery, ctx);
            
            if (searchResults && searchResults.length > 0) {
                const naturalResponse = await generateNaturalResponse(args, searchResults, ctx);
                addToMemory(String(senderId), 'user', args);
                addToMemory(String(senderId), 'assistant', naturalResponse);
                return naturalResponse;
            } else {
                log.warning(`⚠️ Aucun résultat de recherche pour: ${searchDecision.searchQuery}`);
                // Continue avec conversation normale si pas de résultats
            }
        } catch (searchError) {
            log.error(`❌ Erreur recherche intelligente: ${searchError.message}`);
            // Continue avec conversation normale en cas d'erreur
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
                title: 'Information récente',
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

// 🎯 MODIFICATION 1: Génération de réponse naturelle (sans mention de recherche)
async function generateNaturalResponse(originalQuery, searchResults, ctx) {
    const { log, callMistralAPI } = ctx;
    
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
    
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const resultsText = searchResults.map((result, index) => 
            `${result.title}: ${result.description}`
        ).join('\n');
        
        // 🎯 MODIFICATION: Prompt complètement naturel
        const naturalPrompt = `Tu es NakamaBot, une IA conversationnelle empathique et créative.

CONTEXTE TEMPOREL: Nous sommes le ${dateTime}

L'utilisateur te demande: "${originalQuery}"

Voici des informations actuelles pertinentes:
${resultsText}

INSTRUCTIONS IMPORTANTES:
- Réponds comme si tu connaissais naturellement ces informations
- Adopte un ton conversationnel et amical avec quelques emojis
- Maximum 3000 caractères
- Ne mentionne JAMAIS que tu as fait une recherche
- Ne dis jamais "d'après mes recherches" ou "selon les sources"
- Réponds comme dans une conversation normale entre amis
- Si l'information n'est pas complète, reste naturel et honnête

RÉPONSE NATURELLE:`;

        const result = await model.generateContent(naturalPrompt);
        const response = result.response.text();
        
        if (response && response.trim()) {
            log.info(`🎭 Réponse naturelle Gemini pour: ${originalQuery.substring(0, 30)}...`);
            return response;
        }
        
        throw new Error('Réponse Gemini vide');
        
    } catch (geminiError) {
        log.warning(`⚠️ Erreur réponse naturelle Gemini: ${geminiError.message}`);
        
        try {
            // 🎯 MODIFICATION 2: Fallback Mistral aussi naturel
            const messages = [{
                role: "system",
                content: "Tu es NakamaBot. Réponds naturellement comme dans une conversation normale. Ne mentionne jamais de recherches ou sources."
            }, {
                role: "user", 
                content: `Question: "${originalQuery}"\n\nInformations utiles:\n${searchResults.map(r => `${r.title}: ${r.description}`).join('\n')}\n\nRéponds naturellement comme si tu connaissais déjà ces infos (max 3000 chars):`
            }];
            
            const mistralResponse = await callMistralAPI(messages, 3000, 0.7);
            
            if (mistralResponse) {
                log.info(`🔄 Réponse naturelle Mistral pour: ${originalQuery.substring(0, 30)}...`);
                return mistralResponse;
            }
            
            throw new Error('Mistral aussi en échec');
            
        } catch (mistralError) {
            log.error(`❌ Erreur réponse naturelle totale: ${mistralError.message}`);
            
            // 🎯 MODIFICATION 3: Derniers recours plus naturel
            const topResult = searchResults[0];
            if (topResult) {
                const basicResponse = `D'après ce que je sais, ${topResult.description} 💡 ${searchResults.length > 1 ? 'Il y a aussi d\'autres aspects intéressants sur le sujet !' : 'J\'espère que ça répond à ta question !'}`;
                return basicResponse;
            }
            
            // 🎯 MODIFICATION 4: Si vraiment rien ne marche, continue normalement
            return null; // Cela déclenchera la conversation normale
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

// 🆕 SYSTÈME DE DÉTECTION INTELLIGENTE DES COMMANDES
const VALID_COMMANDS = {
    'help': {
        aliases: ['aide', 'commandes', 'commands', 'fonctions', 'que peux tu faire'],
        patterns: [
            /\b(aide|help|commande|fonction|que.*peux.*tu.*faire|comment.*utiliser)\b/i,
            /\b(guide|manuel|instruction|tutorial)\b/i,
            /\b(toutes.*les.*commandes|liste.*commandes)\b/i
        ],
        description: 'Afficher l\'aide et toutes les commandes'
    },
    'image': {
        aliases: ['img', 'photo', 'picture', 'dessine', 'crée', 'génère'],
        patterns: [
            /\b(cr[ée]|g[ée]n[ée]r|fai|dessine|imagine).*?(image|photo|picture|dessin)\b/i,
            /\b(image|photo|picture).*?(de|d'|du|des)\b/i,
            /\b(peux.*tu.*dessiner|peux.*tu.*créer.*image)\b/i
        ],
        description: 'Créer des images uniques avec l\'IA'
    },
    'vision': {
        aliases: ['voir', 'analyser', 'regarder', 'analyze', 'scan'],
        patterns: [
            /\b(analys|regarde|voir|scan|examine|décri).*?(image|photo|picture)\b/i,
            /\b(que.*vois.*tu|qu'est.*ce.*que.*c'est|montre.*image)\b/i,
            /\b(peux.*tu.*voir.*image|reconnaissance.*image)\b/i
        ],
        description: 'Analyser des images avec précision'
    },
    'anime': {
        aliases: ['manga', 'animé', 'style', 'transformer'],
        patterns: [
            /\b(anime|manga|animé).*?(style|transform|conversion)\b/i,
            /\b(transform.*anime|style.*manga|effet.*anime)\b/i,
            /\b(peux.*tu.*transformer.*anime)\b/i
        ],
        description: 'Transformer images en style anime'
    },
    'music': {
        aliases: ['musique', 'chanson', 'son', 'audio', 'youtube'],
        patterns: [
            /\b(musique|chanson|son|audio|youtube|joue|écoute)\b/i,
            /\b(trouve.*musique|cherche.*chanson|mets.*musique)\b/i,
            /\b(peux.*tu.*jouer|peux.*tu.*mettre)\b/i
        ],
        description: 'Trouver musique sur YouTube'
    },
    'clan': {
        aliases: ['bataille', 'guerre', 'empire', 'combat', 'guilde'],
        patterns: [
            /\b(clan|bataille|guerre|empire|combat|guilde|faction)\b/i,
            /\b(rejoindre.*clan|créer.*clan|bataille.*clan)\b/i,
            /\b(système.*clan|communauté|groupe)\b/i
        ],
        description: 'Système de clans et batailles'
    },
    'rank': {
        aliases: ['niveau', 'level', 'xp', 'expérience', 'classement'],
        patterns: [
            /\b(niveau|level|rang|xp|expérience|classement|stats)\b/i,
            /\b(mon.*niveau|mes.*stats|progression)\b/i,
            /\b(leaderboard|top.*joueurs)\b/i
        ],
        description: 'Voir niveau et progression'
    },
    'contact': {
        aliases: ['admin', 'administrateur', 'support', 'problème'],
        patterns: [
            /\b(contact|admin|administrateur|support|problème.*technique)\b/i,
            /\b(contacter.*admin|écrire.*admin|parler.*admin)\b/i,
            /\b(signaler|reporter|bug.*grave)\b/i
        ],
        description: 'Contacter les administrateurs (2/jour max)'
    },
    'weather': {
        aliases: ['météo', 'temps', 'température', 'climat'],
        patterns: [
            /\b(météo|temps|température|climat|prévision)\b/i,
            /\b(quel.*temps|il.*fait.*beau|va.*pleuvoir)\b/i,
            /\b(température.*aujourd|prévisions.*météo)\b/i
        ],
        description: 'Informations météo actuelles'
    }
};

// 🆕 DÉTECTION IA + MOTS-CLÉS DES COMMANDES
async function detectIntelligentCommands(message, ctx) {
    const { log } = ctx;
    
    // Étape 1: Détection rapide par mots-clés
    const keywordDetection = detectCommandByKeywords(message);
    if (keywordDetection.confidence > 0.8) {
        log.info(`⚡ Détection rapide commande: ${keywordDetection.command} (${keywordDetection.confidence})`);
        return keywordDetection;
    }
    
    // Étape 2: Analyse IA si détection incertaine
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const commandsList = Object.keys(VALID_COMMANDS).map(cmd => 
            `${cmd}: ${VALID_COMMANDS[cmd].description}`
        ).join('\n');
        
        const detectionPrompt = `Tu es un système de détection de commandes intelligent pour NakamaBot.

COMMANDES DISPONIBLES:
${commandsList}

MESSAGE UTILISATEUR: "${message}"

Analyse ce message et détermine s'il correspond à une commande spécifique.

CRITÈRES:
✅ L'utilisateur veut clairement utiliser une fonctionnalité
✅ Le message correspond à l'intention d'une commande
✅ Même sans syntaxe /commande, l'intention est claire

❌ Conversations générales qui mentionnent juste le mot
❌ Questions théoriques sur les commandes
❌ Contexte ne suggère pas l'utilisation

Réponds UNIQUEMENT avec ce JSON:
{
  "isCommand": true/false,
  "command": "nom_commande_ou_null",
  "confidence": 0.0-1.0,
  "extractedArgs": "arguments_extraits_ou_message_complet",
  "reason": "explication_courte"
}`;

        const result = await model.generateContent(detectionPrompt);
        const response = result.response.text();
        
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const aiDetection = JSON.parse(jsonMatch[0]);
            
            // Validation de la commande
            if (aiDetection.isCommand && VALID_COMMANDS[aiDetection.command]) {
                log.info(`🤖 Détection IA commande: ${aiDetection.command} (${aiDetection.confidence}) - ${aiDetection.reason}`);
                return {
                    shouldExecute: aiDetection.confidence > 0.6,
                    command: aiDetection.command,
                    args: aiDetection.extractedArgs,
                    confidence: aiDetection.confidence,
                    method: 'ai'
                };
            }
        }
        
    } catch (error) {
        log.warning(`⚠️ Erreur détection IA commandes: ${error.message}`);
    }
    
    // Étape 3: Retourner détection par mots-clés même si faible
    if (keywordDetection.command) {
        return keywordDetection;
    }
    
    return { shouldExecute: false };
}

// 🆕 DÉTECTION PAR MOTS-CLÉS (Fallback rapide)
function detectCommandByKeywords(message) {
    const lowerMessage = message.toLowerCase();
    let bestMatch = { command: null, confidence: 0, args: message };
    
    // Parcourir toutes les commandes
    for (const [commandName, commandData] of Object.entries(VALID_COMMANDS)) {
        let commandScore = 0;
        
        // Vérifier les patterns regex
        for (const pattern of commandData.patterns) {
            if (pattern.test(message)) {
                commandScore += 0.4;
                
                // Extraction d'arguments spécifiques
                if (commandName === 'image') {
                    const match = message.match(/(?:image|photo|dessin).*?(?:de|d'|du)\s+(.+)/i) ||
                                 message.match(/(?:cr[ée]|dessine|génère)\s+(.+)/i);
                    if (match) {
                        bestMatch.args = match[1].trim();
                        commandScore += 0.2;
                    }
                } else if (commandName === 'music') {
                    const match = message.match(/(?:joue|musique|chanson)\s+(.+)/i);
                    if (match) {
                        bestMatch.args = match[1].trim();
                        commandScore += 0.2;
                    }
                }
                break;
            }
        }
        
        // Vérifier les aliases
        for (const alias of commandData.aliases) {
            if (lowerMessage.includes(alias.toLowerCase())) {
                commandScore += 0.3;
                break;
            }
        }
        
        // Bonus pour syntaxe explicite /commande
        if (lowerMessage.includes(`/${commandName}`) || lowerMessage.includes(`!${commandName}`)) {
            commandScore += 0.5;
        }
        
        // Mise à jour du meilleur match
        if (commandScore > bestMatch.confidence) {
            bestMatch = {
                command: commandName,
                confidence: Math.min(commandScore, 1.0),
                args: bestMatch.args,
                method: 'keywords'
            };
        }
    }
    
    return {
        shouldExecute: bestMatch.confidence > 0.5,
        command: bestMatch.command,
        args: bestMatch.args,
        confidence: bestMatch.confidence,
        method: bestMatch.method
    };
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
module.exports.detectIntelligentCommands = detectIntelligentCommands;
module.exports.detectCommandByKeywords = detectCommandByKeywords;
module.exports.VALID_COMMANDS = VALID_COMMANDS;
module.exports.detectCommandIntentions = detectCommandIntentions;
module.exports.executeCommandFromChat = executeCommandFromChat;
module.exports.detectContactAdminIntention = detectContactAdminIntention;
module.exports.decideSearchNecessity = decideSearchNecessity;
module.exports.performIntelligentSearch = performIntelligentSearch;
module.exports.generateNaturalResponse = generateNaturalResponse;
