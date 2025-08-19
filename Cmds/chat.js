/**
 * Commande /chat - Conversation avec Gemini AI (Mistral en fallback) + Recherche Web Intelligente
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios');

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
    
    // ✅ Détection intelligente des besoins de recherche web (NOUVELLE VERSION AMÉLIORÉE)
    const searchAnalysis = await analyzeSearchNeed(args, senderId, ctx);
    if (searchAnalysis.needsSearch) {
        log.info(`🔍 Recherche web intelligente pour ${senderId}: ${searchAnalysis.query}`);
        
        const searchResults = await performIntelligentWebSearch(searchAnalysis.query, searchAnalysis.searchType, ctx);
        if (searchResults && searchResults.length > 0) {
            const enhancedResponse = await generateSearchEnhancedResponse(args, searchResults, ctx);
            addToMemory(String(senderId), 'user', args);
            addToMemory(String(senderId), 'assistant', enhancedResponse);
            return enhancedResponse;
        } else {
            // Si aucun résultat mais recherche demandée, l'indiquer gentiment
            log.info(`⚠️ Recherche demandée mais aucun résultat pour: ${searchAnalysis.query}`);
            const noResultResponse = `🔍 J'ai essayé de chercher des informations récentes sur "${searchAnalysis.query}" mais je n'ai pas trouvé de résultats pertinents. Je peux quand même t'aider avec mes connaissances générales ! 💡`;
            addToMemory(String(senderId), 'user', args);
            addToMemory(String(senderId), 'assistant', noResultResponse);
            // Continuer avec la conversation normale après avoir informé de l'échec
        }
    }
    
    // ✅ Conversation avec Gemini (Mistral en fallback)
    return await handleConversationWithFallback(senderId, args, ctx);
};

// ✅ NOUVELLE FONCTION: Analyse intelligente des besoins de recherche web
async function analyzeSearchNeed(message, senderId, ctx) {
    try {
        // Patterns de détection immédiate (rapide)
        const immediateSearchPatterns = [
            // Actualités et temps réel
            /\b(actualité|news|nouvelles|récent|dernière|dernièrement|maintenant|aujourd'hui|cette semaine|ce mois)\b/i,
            // Données temporelles spécifiques
            /\b(2024|2025|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\b.*\b(2024|2025)\b/i,
            // Questions sur l'état actuel
            /\b(que se passe|quoi de neuf|situation actuelle|état actuel|comment ça va|dernier|plus récent)\b/i,
            // Événements en cours
            /\b(en cours|événement|festival|élection|match|championnat|tournoi|concert|conférence)\b/i,
            // Prix et cours actuels
            /\b(prix|cours|bourse|crypto|bitcoin|euro|dollar|inflation|taux)\b.*\b(actuel|maintenant|aujourd'hui)\b/i,
            // Météo et conditions
            /\b(météo|temps|température|climat|prévision)\b/i
        ];
        
        // Vérification rapide
        const hasImmediatePattern = immediateSearchPatterns.some(pattern => pattern.test(message));
        
        if (hasImmediatePattern) {
            return {
                needsSearch: true,
                query: extractSearchQuery(message),
                searchType: 'immediate',
                confidence: 0.9
            };
        }
        
        // Analyse IA pour les cas complexes
        const aiAnalysis = await analyzeWithAI(message, ctx);
        return aiAnalysis;
        
    } catch (error) {
        console.error('Erreur analyse recherche:', error);
        return { needsSearch: false };
    }
}

// ✅ Analyse avec IA pour déterminer le besoin de recherche
async function analyzeWithAI(message, ctx) {
    try {
        const analysisPrompt = `Analyse ce message utilisateur et détermine s'il nécessite une recherche web récente.

Message: "${message}"

Réponds UNIQUEMENT par un JSON valide avec cette structure:
{
    "needsSearch": boolean,
    "query": "requête de recherche optimisée" ou null,
    "searchType": "news" | "general" | "specific" ou null,
    "reason": "explication courte"
}

Critères pour needsSearch=true:
- Demande d'actualités, événements récents
- Questions sur des prix, cours, données actuelles  
- Informations temporelles spécifiques (dates récentes)
- Sujets qui évoluent rapidement
- Vérification de faits récents

Critères pour needsSearch=false:
- Questions générales/théoriques
- Définitions stables
- Conversations personnelles
- Demandes créatives
- Sujets intemporels`;

        // Essai avec Gemini d'abord
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            const result = await model.generateContent(analysisPrompt);
            const response = result.response.text();
            
            // Extraction du JSON de la réponse
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const analysis = JSON.parse(jsonMatch[0]);
                return {
                    needsSearch: analysis.needsSearch || false,
                    query: analysis.needsSearch ? (analysis.query || message) : null,
                    searchType: analysis.searchType || 'general',
                    confidence: 0.8
                };
            }
        } catch (geminiError) {
            console.log('Gemini échec pour analyse, fallback Mistral');
        }
        
        // Fallback avec Mistral
        try {
            const { callMistralAPI } = ctx;
            const mistralResponse = await callMistralAPI([
                { role: "system", content: "Tu analyses si un message nécessite une recherche web. Réponds uniquement par JSON valide." },
                { role: "user", content: analysisPrompt }
            ], 300, 0.3);
            
            const jsonMatch = mistralResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const analysis = JSON.parse(jsonMatch[0]);
                return {
                    needsSearch: analysis.needsSearch || false,
                    query: analysis.needsSearch ? (analysis.query || message) : null,
                    searchType: analysis.searchType || 'general',
                    confidence: 0.7
                };
            }
        } catch (mistralError) {
            console.log('Mistral aussi en échec pour analyse');
        }
        
    } catch (error) {
        console.error('Erreur analyse IA:', error);
    }
    
    return { needsSearch: false };
}

// ✅ Extraction de requête de recherche optimisée
function extractSearchQuery(message) {
    // Nettoyer le message pour extraire les termes clés
    let query = message;
    
    // Supprimer les mots de liaison courants
    const stopWords = /\b(le|la|les|de|du|des|un|une|et|ou|mais|car|donc|pour|dans|sur|avec|sans|que|qui|quoi|comment|pourquoi|où|quand|combien)\b/gi;
    query = query.replace(stopWords, ' ');
    
    // Supprimer les mots interrogatifs en début
    query = query.replace(/^(dis-moi|peux-tu|pourrais-tu|est-ce que|qu'est-ce que)\s+/i, '');
    
    // Nettoyer les espaces multiples
    query = query.replace(/\s+/g, ' ').trim();
    
    // Limiter à 10 mots maximum pour l'efficacité
    const words = query.split(' ').slice(0, 10);
    
    return words.join(' ');
}

// ✅ NOUVELLE FONCTION: Recherche web intelligente avec API gratuite (Version Améliorée)
async function performIntelligentWebSearch(query, searchType = 'general', ctx) {
    const { log } = ctx;
    
    try {
        console.log('🔍 Démarrage recherche intelligente pour:', query);
        
        // Vérifier le cache d'abord
        const cached = getCachedSearch(query);
        if (cached) {
            console.log('💾 Résultat trouvé en cache');
            updateSearchStats(searchType, true, true);
            return cached;
        }
        
        // Essayer DuckDuckGo avec la méthode corrigée
        const ddgResults = await searchWithDuckDuckGo(query, searchType);
        if (ddgResults && ddgResults.length > 0) {
            console.log('✅ DuckDuckGo réussi:', ddgResults.length, 'résultats');
            setCachedSearch(query, ddgResults);
            updateSearchStats(searchType, true, false);
            return ddgResults;
        }
        
        // Fallback avec recherche générique si DuckDuckGo échoue
        const genericResults = await searchWithGenericAPI(query, searchType);
        if (genericResults && genericResults.length > 0) {
            console.log('✅ Recherche générique réussie:', genericResults.length, 'résultats');
            setCachedSearch(query, genericResults);
            updateSearchStats(searchType, true, false);
            return genericResults;
        }
        
        // Fallback SerpAPI si configuré
        if (process.env.SERPAPI_KEY) {
            const serpResults = await searchWithGoogleScraping(query, searchType);
            if (serpResults && serpResults.length > 0) {
                console.log('✅ SerpAPI réussi:', serpResults.length, 'résultats');
                setCachedSearch(query, serpResults);
                updateSearchStats(searchType, true, false);
                return serpResults;
            }
        }
        
        log.warning('⚠️ Toutes les méthodes de recherche ont échoué pour:', query);
        updateSearchStats(searchType, false, false);
        return null;
        
    } catch (error) {
        log.error(`❌ Erreur recherche web: ${error.message}`);
        updateSearchStats(searchType, false, false);
        return null;
    }
}

// ✅ Recherche générique de secours (utilise plusieurs sources)
async function searchWithGenericAPI(query, searchType) {
    try {
        // Essayer avec Wikipedia API en français d'abord
        const wikiResults = await searchWikipedia(query);
        if (wikiResults && wikiResults.length > 0) {
            return wikiResults;
        }
        
        // Essayer une recherche Bing sans clé (limitée mais gratuite)
        const bingResults = await searchBingFree(query);
        if (bingResults && bingResults.length > 0) {
            return bingResults;
        }
        
        return null;
        
    } catch (error) {
        console.error('Erreur recherche générique:', error.message);
        return null;
    }
}

// ✅ Recherche Wikipedia (toujours fiable)
async function searchWikipedia(query) {
    try {
        console.log('📚 Recherche Wikipedia pour:', query);
        
        // API Wikipedia française
        const searchUrl = `https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
        
        const response = await axios.get(searchUrl, {
            timeout: 8000,
            headers: {
                'User-Agent': 'NakamaBot/1.0 (https://github.com/nakamabot)'
            }
        });
        
        const data = response.data;
        
        if (data.extract && data.extract.trim()) {
            return [{
                title: data.title || 'Article Wikipedia',
                snippet: data.extract,
                url: data.content_urls?.desktop?.page || `https://fr.wikipedia.org/wiki/${encodeURIComponent(query)}`,
                source: 'Wikipedia FR',
                type: 'encyclopedia'
            }];
        }
        
        return null;
        
    } catch (error) {
        // Essayer en anglais si français échoue
        try {
            const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
            
            const response = await axios.get(searchUrl, {
                timeout: 8000,
                headers: {
                    'User-Agent': 'NakamaBot/1.0 (https://github.com/nakamabot)'
                }
            });
            
            const data = response.data;
            
            if (data.extract && data.extract.trim()) {
                return [{
                    title: data.title || 'Wikipedia Article',
                    snippet: data.extract,
                    url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}`,
                    source: 'Wikipedia EN',
                    type: 'encyclopedia'
                }];
            }
        } catch (enError) {
            console.log('❌ Wikipedia FR et EN échouées');
        }
        
        return null;
    }
}

// ✅ Recherche Bing gratuite (limitée mais fonctionne)
async function searchBingFree(query) {
    try {
        console.log('🔎 Recherche Bing gratuite pour:', query);
        
        // Cette méthode utilise l'interface publique de Bing (attention aux limites)
        const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`;
        
        const response = await axios.get(searchUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; NakamaBot/1.0; +https://github.com/nakamabot)'
            }
        });
        
        // Parser très basique du RSS (pas parfait mais fonctionne)
        const rssContent = response.data;
        const items = rssContent.match(/<item>[\s\S]*?<\/item>/g) || [];
        
        const results = [];
        items.slice(0, 3).forEach(item => {
            const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
            const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/);
            const linkMatch = item.match(/<link>(.*?)<\/link>/);
            
            if (titleMatch && descMatch) {
                results.push({
                    title: titleMatch[1],
                    snippet: descMatch[1].replace(/<[^>]*>/g, '').substring(0, 200),
                    url: linkMatch ? linkMatch[1] : '',
                    source: 'Bing',
                    type: 'web'
                });
            }
        });
        
        return results.length > 0 ? results : null;
        
    } catch (error) {
        console.error('❌ Bing gratuit échoué:', error.message);
        return null;
    }
}

// ✅ Recherche avec DuckDuckGo API (Gratuite) - Version Corrigée
async function searchWithDuckDuckGo(query, searchType) {
    try {
        console.log('🔍 Recherche DuckDuckGo pour:', query);
        
        // API DuckDuckGo avec les bons paramètres (basé sur votre exemple)
        const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1`;
        
        const response = await axios.get(ddgUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        const data = response.data;
        console.log('📊 Données reçues:', {
            hasAbstract: !!data.AbstractText,
            hasDefinition: !!data.Definition,
            hasAnswer: !!data.Answer,
            relatedTopicsCount: data.RelatedTopics ? data.RelatedTopics.length : 0,
            hasResults: !!data.Results?.length
        });
        
        const results = [];
        
        // 1. Réponse directe (Answer)
        if (data.Answer && data.Answer.trim()) {
            results.push({
                title: data.AnswerType || 'Réponse directe',
                snippet: data.Answer,
                url: '',
                source: 'DuckDuckGo Answer',
                type: 'featured'
            });
        }
        
        // 2. Résumé (AbstractText + AbstractSource)
        if (data.AbstractText && data.AbstractText.trim()) {
            results.push({
                title: data.Heading || 'Résumé',
                snippet: data.AbstractText,
                url: data.AbstractURL || '',
                source: data.AbstractSource || 'DuckDuckGo',
                type: 'instant'
            });
        }
        
        // 3. Définition
        if (data.Definition && data.Definition.trim()) {
            results.push({
                title: 'Définition',
                snippet: data.Definition,
                url: data.DefinitionURL || '',
                source: data.DefinitionSource || 'DuckDuckGo',
                type: 'definition'
            });
        }
        
        // 4. Infobox (données structurées)
        if (data.Infobox && data.Infobox.content && data.Infobox.content.length > 0) {
            const infoText = data.Infobox.content
                .filter(item => item.data_type === 'string' && item.value)
                .slice(0, 3)
                .map(item => `${item.label}: ${item.value}`)
                .join(', ');
                
            if (infoText) {
                results.push({
                    title: data.Infobox.meta?.[0]?.label || 'Informations',
                    snippet: infoText,
                    url: '',
                    source: 'DuckDuckGo Infobox',
                    type: 'structured'
                });
            }
        }
        
        // 5. Topics relatifs (améliorés)
        if (data.RelatedTopics && Array.isArray(data.RelatedTopics) && data.RelatedTopics.length > 0) {
            data.RelatedTopics.slice(0, 2).forEach(topic => {
                if (topic.Text && topic.Text.trim() && topic.FirstURL) {
                    const titleMatch = topic.Text.match(/^([^-]+)/);
                    results.push({
                        title: titleMatch ? titleMatch[1].trim() : 'Information connexe',
                        snippet: topic.Text,
                        url: topic.FirstURL,
                        source: 'DuckDuckGo',
                        type: 'related'
                    });
                }
            });
        }
        
        // 6. Results directs (si disponibles)
        if (data.Results && Array.isArray(data.Results) && data.Results.length > 0) {
            data.Results.slice(0, 2).forEach(result => {
                if (result.Text && result.FirstURL) {
                    results.push({
                        title: result.Text.split(' - ')[0] || 'Résultat',
                        snippet: result.Text,
                        url: result.FirstURL,
                        source: 'DuckDuckGo Results',
                        type: 'organic'
                    });
                }
            });
        }
        
        console.log(`✅ DuckDuckGo: ${results.length} résultats trouvés`);
        
        if (results.length === 0) {
            console.log('⚠️ DuckDuckGo: Aucun résultat exploitable pour:', query);
            // Essayer une recherche alternative simplifiée
            return await searchWithSimplifiedQuery(query);
        }
        
        return results;
        
    } catch (error) {
        console.error('❌ Erreur DuckDuckGo:', error.message);
        return await searchWithSimplifiedQuery(query);
    }
}

// ✅ Recherche de secours avec requête simplifiée
async function searchWithSimplifiedQuery(originalQuery) {
    try {
        // Simplifier la requête (garder seulement les mots clés importants)
        const simplified = originalQuery
            .replace(/\b(que|qui|quoi|comment|pourquoi|où|quand|le|la|les|des?|un|une|ce|cette|est|sont|fait|faire|dire|aujourd'hui|maintenant|récent)\b/gi, '')
            .replace(/[?!.,;]/g, '')
            .trim()
            .split(' ')
            .filter(word => word.length > 2)
            .slice(0, 3)
            .join(' ');
            
        if (simplified && simplified !== originalQuery) {
            console.log('🔄 Recherche simplifiée:', simplified);
            
            const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(simplified)}&format=json&no_html=1&no_redirect=1`;
            
            const response = await axios.get(ddgUrl, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; NakamaBot/1.0)'
                }
            });
            
            const data = response.data;
            const results = [];
            
            if (data.AbstractText?.trim()) {
                results.push({
                    title: 'Information trouvée',
                    snippet: data.AbstractText,
                    url: data.AbstractURL || '',
                    source: data.AbstractSource || 'DuckDuckGo',
                    type: 'simplified'
                });
            }
            
            return results.length > 0 ? results : null;
        }
        
        return null;
        
    } catch (error) {
        console.error('❌ Erreur recherche simplifiée:', error.message);
        return null;
    }
}

// ✅ Recherche Google avec scraping léger (backup)
async function searchWithGoogleScraping(query, searchType) {
    try {
        // Utilisation de l'API SerpAPI gratuite (100 recherches/mois)
        // Remplace par ta clé API gratuite de SerpAPI
        const serpApiKey = process.env.SERPAPI_KEY;
        
        if (!serpApiKey) {
            return null;
        }
        
        const serpUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${serpApiKey}&num=5`;
        
        const response = await axios.get(serpUrl, {
            timeout: 10000
        });
        
        const data = response.data;
        const results = [];
        
        // Résultats organiques
        if (data.organic_results) {
            data.organic_results.slice(0, 5).forEach(result => {
                results.push({
                    title: result.title || 'Résultat',
                    snippet: result.snippet || '',
                    url: result.link || '',
                    source: 'Google',
                    type: 'organic'
                });
            });
        }
        
        // Featured snippet (réponse mise en avant)
        if (data.answer_box) {
            results.unshift({
                title: data.answer_box.title || 'Réponse directe',
                snippet: data.answer_box.answer || data.answer_box.snippet || '',
                url: data.answer_box.link || '',
                source: 'Google Featured',
                type: 'featured'
            });
        }
        
        return results.length > 0 ? results : null;
        
    } catch (error) {
        console.error('Erreur SerpAPI:', error.message);
        return null;
    }
}

// ✅ Génération de réponse enrichie avec les résultats de recherche
async function generateSearchEnhancedResponse(originalMessage, searchResults, ctx) {
    try {
        // Préparer le contexte de recherche
        const searchContext = searchResults.slice(0, 3).map((result, index) => 
            `[${index + 1}] ${result.title}: ${result.snippet}`
        ).join('\n');
        
        const enhancementPrompt = `Question utilisateur: "${originalMessage}"

Résultats de recherche récents:
${searchContext}

Génère une réponse naturelle et conversationnelle qui:
1. Répond directement à la question
2. Intègre les informations de recherche pertinentes
3. Reste dans un style amical et accessible
4. Maximum 2000 caractères
5. Ajoute 🔍 en début pour indiquer l'usage de la recherche web

Important: Présente l'information comme une connaissance récente, pas comme une liste de résultats.`;

        // Essayer avec Gemini d'abord
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            const result = await model.generateContent(enhancementPrompt);
            const response = result.response.text();
            
            if (response && response.trim()) {
                return response;
            }
        } catch (geminiError) {
            console.log('Gemini échec pour synthèse, essai Mistral');
        }
        
        // Fallback Mistral
        try {
            const { callMistralAPI } = ctx;
            const mistralResponse = await callMistralAPI([
                { role: "system", content: "Tu es un assistant qui synthétise des informations de recherche web de manière naturelle et conversationnelle." },
                { role: "user", content: enhancementPrompt }
            ], 1500, 0.7);
            
            if (mistralResponse) {
                return mistralResponse;
            }
        } catch (mistralError) {
            console.log('Mistral aussi en échec pour synthèse');
        }
        
        // Fallback simple si tout échoue
        const bestResult = searchResults[0];
        return `🔍 D'après mes recherches récentes : ${bestResult.snippet}\n\nSource: ${bestResult.source}`;
        
    } catch (error) {
        console.error('Erreur génération réponse enrichie:', error);
        return `🔍 J'ai trouvé des informations récentes mais j'ai du mal à les synthétiser. Voici le plus pertinent : ${searchResults[0].snippet}`;
    }
}

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
- Tu as accès à des recherches web récentes quand nécessaire

CAPACITÉS PRINCIPALES:
🎨 /image [description] - Créer des images uniques
👁️ /vision - Analyser des images avec précision
🌸 /anime - Transformer images en style anime
🎵 /music [titre] - Trouver musique sur YouTube
🛡️ /clan - Système de clans et batailles
📞 /contact [message] - Contacter les admins (2/jour max)
🆘 /help - Toutes les commandes disponibles
🔍 Recherche web intelligente automatique

DIRECTIVES:
- Parle selon la langue de l\'utilisateur et du contexte
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

// ✅ Détection des intentions de commandes (optimisée)
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

// ✅ NOUVELLES FONCTIONS UTILITAIRES

// Configuration pour les variables d'environnement nécessaires
const REQUIRED_ENV_VARS = {
    GEMINI_API_KEY: 'Clé API Google Gemini (gratuite)',
    SERPAPI_KEY: 'Clé API SerpAPI (optionnel, 100 recherches gratuites/mois)'
};

// ✅ Fonction de vérification des clés API
function checkApiKeys() {
    const missing = [];
    const warnings = [];
    
    if (!process.env.GEMINI_API_KEY) {
        missing.push('GEMINI_API_KEY (requis pour l\'IA)');
    }
    
    if (!process.env.SERPAPI_KEY) {
        warnings.push('SERPAPI_KEY (optionnel pour recherches Google avancées)');
    }
    
    if (missing.length > 0) {
        console.error('❌ Variables d\'environnement manquantes:', missing.join(', '));
        console.log('📝 Obtenir Gemini API: https://makersuite.google.com/app/apikey');
    }
    
    if (warnings.length > 0) {
        console.log('⚠️ Optionnel manquant:', warnings.join(', '));
        console.log('📝 SerpAPI gratuit: https://serpapi.com/');
    }
    
    return missing.length === 0;
}

// ✅ Cache simple pour éviter les recherches répétitives
const searchCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getCachedSearch(query) {
    const cached = searchCache.get(query.toLowerCase());
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.results;
    }
    return null;
}

function setCachedSearch(query, results) {
    searchCache.set(query.toLowerCase(), {
        results,
        timestamp: Date.now()
    });
    
    // Nettoyer le cache si trop grand
    if (searchCache.size > 100) {
        const oldestKey = searchCache.keys().next().value;
        searchCache.delete(oldestKey);
    }
}

// ✅ Amélioration de la recherche DuckDuckGo avec cache
async function searchWithDuckDuckGoEnhanced(query, searchType) {
    // Vérifier le cache
    const cached = getCachedSearch(query);
    if (cached) {
        console.log('🎯 Résultat de recherche en cache pour:', query);
        return cached;
    }
    
    try {
        const results = await searchWithDuckDuckGo(query, searchType);
        
        if (results && results.length > 0) {
            setCachedSearch(query, results);
            console.log('🔍 Nouvelle recherche DuckDuckGo:', query, '- Résultats:', results.length);
        }
        
        return results;
        
    } catch (error) {
        console.error('Erreur recherche DuckDuckGo Enhanced:', error.message);
        return null;
    }
}

// ✅ Fonction de recherche avec retry automatique
async function performIntelligentWebSearchWithRetry(query, searchType = 'general', ctx, maxRetries = 2) {
    const { log } = ctx;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Essayer DuckDuckGo en premier (gratuit illimité)
            let results = await searchWithDuckDuckGoEnhanced(query, searchType);
            if (results && results.length > 0) {
                log.info(`✅ Recherche DuckDuckGo réussie (tentative ${attempt}): ${results.length} résultats`);
                return results;
            }
            
            // Fallback SerpAPI si configuré
            if (process.env.SERPAPI_KEY) {
                results = await searchWithGoogleScraping(query, searchType);
                if (results && results.length > 0) {
                    log.info(`✅ Recherche SerpAPI réussie (tentative ${attempt}): ${results.length} résultats`);
                    return results;
                }
            }
            
            // Attendre avant nouvelle tentative
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
            
        } catch (error) {
            log.warning(`⚠️ Tentative ${attempt} échouée:`, error.message);
            
            if (attempt === maxRetries) {
                throw error;
            }
        }
    }
    
    return null;
}

// ✅ Fonction de formatage intelligent des résultats
function formatSearchResults(results, maxResults = 3) {
    if (!results || !Array.isArray(results)) return '';
    
    const priorityOrder = ['featured', 'instant', 'definition', 'organic', 'related'];
    
    // Trier par priorité
    results.sort((a, b) => {
        const aPriority = priorityOrder.indexOf(a.type) !== -1 ? priorityOrder.indexOf(a.type) : 999;
        const bPriority = priorityOrder.indexOf(b.type) !== -1 ? priorityOrder.indexOf(b.type) : 999;
        return aPriority - bPriority;
    });
    
    return results.slice(0, maxResults).map((result, index) => {
        const emoji = getResultEmoji(result.type);
        const snippet = result.snippet.length > 150 ? 
            result.snippet.substring(0, 147) + '...' : 
            result.snippet;
            
        return `${emoji} **${result.title}**\n${snippet}`;
    }).join('\n\n');
}

// ✅ Emojis pour types de résultats
function getResultEmoji(type) {
    const emojis = {
        'featured': '⭐',
        'instant': '🎯',
        'definition': '📚',
        'organic': '🔍',
        'related': '🔗',
        'news': '📰'
    };
    return emojis[type] || '📄';
}

// ✅ Détection de langue pour requêtes multilingues
function detectLanguageAndAdjustQuery(query) {
    const frenchPatterns = /\b(le|la|les|des|une?|ce|cette|qui|que|quoi|où|quand|comment|pourquoi|avec|sans|dans|sur|pour|par|de|du|et|ou|mais|donc|car|si|alors|aujourd'hui|maintenant|récemment)\b/i;
    const englishPatterns = /\b(the|a|an|and|or|but|in|on|at|to|for|of|with|by|from|about|what|where|when|how|why|today|now|recently)\b/i;
    
    const isFrench = frenchPatterns.test(query);
    const isEnglish = englishPatterns.test(query) && !isFrench;
    
    return {
        language: isFrench ? 'fr' : (isEnglish ? 'en' : 'auto'),
        adjustedQuery: query // On pourrait optimiser la requête selon la langue
    };
}

// ✅ Statistiques de recherche (pour monitoring)
const searchStats = {
    total: 0,
    successful: 0,
    cached: 0,
    byType: {},
    errors: []
};

function updateSearchStats(type, success, fromCache = false) {
    searchStats.total++;
    if (success) searchStats.successful++;
    if (fromCache) searchStats.cached++;
    
    searchStats.byType[type] = (searchStats.byType[type] || 0) + 1;
    
    // Garder seulement les 10 dernières erreurs
    if (!success && searchStats.errors.length >= 10) {
        searchStats.errors.shift();
    }
}

function getSearchStats() {
    return {
        ...searchStats,
        successRate: searchStats.total > 0 ? (searchStats.successful / searchStats.total * 100).toFixed(1) + '%' : '0%',
        cacheRate: searchStats.total > 0 ? (searchStats.cached / searchStats.total * 100).toFixed(1) + '%' : '0%'
    };
}

// ✅ Exports pour autres modules
module.exports.detectCommandIntentions = detectCommandIntentions;
module.exports.executeCommandFromChat = executeCommandFromChat;
module.exports.detectContactAdminIntention = detectContactAdminIntention;
module.exports.performIntelligentWebSearch = performIntelligentWebSearchWithRetry;
module.exports.checkApiKeys = checkApiKeys;
module.exports.getSearchStats = getSearchStats;

// ✅ Initialisation au démarrage
(function initialize() {
    console.log('🚀 NakamaBot Chat Enhanced - Initialisation...');
    
    if (checkApiKeys()) {
        console.log('✅ Configuration API validée');
    }
    
    console.log('🔍 Recherche web intelligente activée');
    console.log('💾 Cache de recherche initialisé');
    console.log('📊 Statistiques de recherche activées');
    
    // Nettoyer le cache périodiquement
    setInterval(() => {
        const now = Date.now();
        for (const [key, value] of searchCache.entries()) {
            if ((now - value.timestamp) > CACHE_TTL) {
                searchCache.delete(key);
            }
        }
    }, 10 * 60 * 1000); // Nettoyage toutes les 10 minutes
    
    console.log('🎯 NakamaBot prêt avec recherche web avancée !');
})();
