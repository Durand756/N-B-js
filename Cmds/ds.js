/**
 * Commande /ds - Conversation avec DeepSeek R1 via OpenRouter
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */

const axios = require('axios');

// Configuration DeepSeek via OpenRouter
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const DEEPSEEK_MODEL = "deepseek/deepseek-r1-0528:free";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Fonction pour appeler DeepSeek via OpenRouter
async function callDeepSeekAPI(messages, maxTokens = 2000, temperature = 0.7) {
    if (!OPENROUTER_API_KEY) {
        return null;
    }
    
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://nakamabot.app", // Site URL pour les rankings
        "X-Title": "NakamaBot - Assistant IA Amical" // Titre du site
    };
    
    const data = {
        model: DEEPSEEK_MODEL,
        messages: messages,
        max_tokens: maxTokens,
        temperature: temperature
    };
    
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await axios.post(
                `${OPENROUTER_BASE_URL}/chat/completions`,
                data,
                { headers, timeout: 45000 } // Timeout plus long pour DeepSeek
            );
            
            if (response.status === 200 && response.data.choices?.[0]?.message?.content) {
                return response.data.choices[0].message.content;
            } else if (response.status === 401) {
                console.error("❌ Clé API OpenRouter invalide");
                return null;
            } else {
                if (attempt === 0) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    continue;
                }
                return null;
            }
        } catch (error) {
            if (attempt === 0) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                continue;
            }
            console.error(`❌ Erreur DeepSeek: ${error.message}`);
            return null;
        }
    }
    
    return null;
}

module.exports = async function cmdDeepSeek(senderId, args, ctx) {
    const { addToMemory, getMemoryContext, log } = ctx;
    
    if (!args.trim()) {
        const welcomeMsg = "🧠 Salut ! Je suis DeepSeek R1, une IA de raisonnement avancée créée par DeepSeek ! 🚀\n\n💭 Je peux t'aider avec :\n• Raisonnement complexe et logique\n• Analyse approfondie de problèmes\n• Mathématiques et sciences\n• Programmation avancée\n• Réflexion créative\n\n✨ Pose-moi une question qui nécessite de la réflexion profonde !";
        addToMemory(String(senderId), 'assistant', welcomeMsg);
        return welcomeMsg;
    }
    
    // Enregistrer le message utilisateur
    addToMemory(String(senderId), 'user', args);
    
    // Récupération du contexte de conversation
    const context = getMemoryContext(String(senderId));
    const messageCount = context.filter(msg => msg.role === 'user').length;
    
    // Système de prompt optimisé pour DeepSeek R1
    const systemPrompt = `Tu es DeepSeek R1, une IA de raisonnement avancée développée par DeepSeek, intégrée dans NakamaBot par Durand.

CAPACITÉS SPÉCIALISÉES:
- 🧠 Raisonnement profond et analytique
- 🔍 Analyse multicouche des problèmes complexes  
- 🧮 Excellence en mathématiques, sciences et logique
- 💻 Programmation et algorithmes avancés
- 🎯 Résolution méthodique de problèmes
- 🤔 Pensée critique et évaluation d'arguments

STYLE DE RAISONNEMENT:
- Décompose les problèmes complexes étape par étape
- Explique ton processus de réflexion clairement
- Considère plusieurs angles avant de conclure
- Utilise des exemples concrets quand approprié
- Reconnais les limites et incertitudes

COMMUNICATION:
- Sois précis et structuré dans tes réponses
- Utilise des emojis pour clarifier (🔍 analyse, 💡 insight, ⚡ solution)
- Maximum 2000 caractères par réponse
- Adapte ton niveau de détail selon la complexité du problème
- ${messageCount >= 3 ? 'Tu peux suggérer /help pour découvrir d\'autres fonctionnalités de NakamaBot' : ''}

SPÉCIALITÉS:
- Questions scientifiques et techniques
- Problèmes mathématiques complexes  
- Analyse de code et optimisation
- Raisonnement logique et philosophique
- Stratégies de résolution créative

Tu es une IA de raisonnement de pointe qui excelle dans l'analyse profonde et la résolution méthodique de problèmes complexes.`;

    const messages = [{ role: "system", content: systemPrompt }];
    messages.push(...context);
    messages.push({ role: "user", content: args });
    
    log.info(`🧠 Appel DeepSeek R1 pour ${senderId}: ${args.substring(0, 50)}...`);
    
    const response = await callDeepSeekAPI(messages, 2000, 0.3); // Température plus basse pour plus de précision
    
    if (response) {
        // Nettoyer la réponse si elle contient des balises de raisonnement
        let cleanResponse = response;
        
        // Supprimer les balises <think> si présentes (DeepSeek R1 les utilise parfois)
        cleanResponse = cleanResponse.replace(/<think>[\s\S]*?<\/think>/gi, '');
        
        // Nettoyer les espaces multiples
        cleanResponse = cleanResponse.replace(/\n{3,}/g, '\n\n').trim();
        
        addToMemory(String(senderId), 'assistant', cleanResponse);
        log.info(`✅ Réponse DeepSeek générée pour ${senderId}`);
        return cleanResponse;
    } else {
        const errorResponse = "🤖 Désolé, DeepSeek R1 rencontre une difficulté technique en ce moment. Peux-tu réessayer dans quelques instants ? En attendant, tu peux utiliser /chat pour une conversation normale ! 💫";
        addToMemory(String(senderId), 'assistant', errorResponse);
        log.warning(`❌ Échec appel DeepSeek pour ${senderId}`);
        return errorResponse;
    }
};
