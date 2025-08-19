/**
 * Commande /chat - Conversation avec Gemini AI (Mistral en fallback) + Recherche Web Intelligente
 * Version corrigée avec APIs 100% gratuites et fiables
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Message de conversation
 * @param {object} ctx - Contexte partagé du bot 
 */
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cheerio = require('cheerio'); // Pour le scraping léger

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
    
    // ✅ Détection intelligente des besoins de recherche web (VERSION AMÉLIORÉE)
    const searchAnalysis = await analyzeSearchNeed(args, senderId, ctx);
    if (searchAnalysis.needsSearch) {
        log.info(`🔍 Recherche web intelligente pour ${senderId}: ${searchAnalysis.query}`);
        
        const searchResults = await performReliableWebSearch(searchAnalysis.query, searchAnalysis.searchType, ctx);
        if (searchResults && searchResults.length > 0) {
            const enhancedResponse = await generateSearchEnhancedResponse(args, searchResults, ctx);
            addToMemory(String(senderId), 'user', args);
            addToMemory(String(senderId), 'assistant', enhancedResponse);
            return enhancedResponse;
        } else {
            log.info(`⚠️ Recherche demandée mais aucun résultat pour: ${searchAnalysis.query}`);
            const noResultResponse = `🔍 J'ai essayé de chercher des informations récentes mais je n'ai pas trouvé de résultats pertinents pour "${searchAnalysis.query}". Je peux quand même t'aider avec mes connaissances générales ! 💡`;
            addToMemory(String(senderId), 'user', args);
            addToMemory(String(senderId), 'assistant', noResultResponse);
        }
    }
    
    // ✅ Conversation avec Gemini (Mistral en fallback)
    return await handleConversationWithFallback(senderId, args, ctx);
};

// ✅ ANALYSE INTELLIGENTE DES BESOINS DE RECHERCHE (VERSION OPTIMISÉE)
async function analyzeSearchNeed(message, senderId, ctx) {
    try {
        // Nettoyage et normalisation du message
        const cleanMessage = message.toLowerCase().trim();
        
        // Patterns de détection immédiate (plus précis)
        const immediateSearchPatterns = [
            // Actualités et événements récents
            {
                regex: /\b(actualité|news|nouvelles|récent|dernier|dernière|aujourd'hui|cette semaine|maintenant|en cours)\b/i,
                type: 'news',
                confidence: 0.9
            },
            // Sports et compétitions
            {
                regex: /\b(champion|championnat|ligue|coupe|match|tournoi|finale|gagnant|vainqueur|résultat|score)\b.*\b(2024|2025|récent|dernier|dernière)\b/i,
                type: 'sports',
                confidence: 0.95
            },
            // Données temporelles spécifiques
            {
                regex: /\b(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(2024|2025)\b/i,
                type: 'temporal',
                confidence: 0.9
            },
            // Prix et cours actuels
            {
                regex: /\b(prix|cours|bourse|crypto|bitcoin|ethereum|euro|dollar|inflation|taux)\b.*\b(actuel|maintenant|aujourd'hui|récent)\b/i,
                type: 'financial',
                confidence: 0.85
            },
            // Météo
            {
                regex: /\b(météo|temps|température|prévision|climat)\b/i,
                type: 'weather',
                confidence: 0.8
            }
        ];
        
        // Vérification rapide avec patterns améliorés
        for (const pattern of immediateSearchPatterns) {
            if (pattern.regex.test(message)) {
                const optimizedQuery = optimizeSearchQuery(message, pattern.type);
                return {
                    needsSearch: true,
                    query: optimizedQuery,
                    searchType: pattern.type,
                    confidence: pattern.confidence
                };
            }
        }
        
        // Analyse IA pour les cas complexes (plus ciblée)
        if (containsSearchIndicators(message)) {
            const aiAnalysis = await analyzeWithAI(message, ctx);
            return aiAnalysis;
        }
        
        return { needsSearch: false };
        
    } catch (error) {
        console.error('Erreur analyse recherche:', error);
        return { needsSearch: false };
    }
}

// ✅ OPTIMISATION DES REQUÊTES DE RECHERCHE
function optimizeSearchQuery(message, searchType) {
    let query = message.toLowerCase();
    
    // Suppression des mots inutiles selon le contexte
    const commonStopWords = /\b(le|la|les|de|du|des|un|une|et|ou|mais|car|donc|pour|dans|sur|avec|sans|que|qui|quoi|comment|pourquoi|où|quand|combien|dis-moi|peux-tu|pourrais-tu|est-ce que|qu'est-ce que|raconte-moi|explique-moi)\b/gi;
    
    // Nettoyage de base
    query = query.replace(commonStopWords, ' ')
                .replace(/[?!.,;]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
    
    // Optimisation spécifique par type
    switch (searchType) {
        case 'sports':
            // Préserver les termes sportifs importants
            const sportsTerms = query.match(/\b(champion|championnat|ligue|coupe|finale|real madrid|barcelona|psg|manchester|liverpool|milan|juventus|bayern|dortmund|atletico)\b/gi);
            if (sportsTerms) {
                query = sportsTerms.join(' ') + ' 2024 résultats';
            }
            break;
            
        case 'news':
            // Ajouter des termes temporels pour les actualités
            if (!/\b(2024|2025|récent|aujourd'hui|maintenant)\b/i.test(query)) {
                query += ' actualités 2024';
            }
            break;
            
        case 'financial':
            // Optimiser pour les données financières
            const finTerms = query.match(/\b(bitcoin|ethereum|euro|dollar|bourse|crypto)\b/gi);
            if (finTerms) {
                query = finTerms.join(' ') + ' cours prix actuel';
            }
            break;
            
        case 'weather':
            // Météo avec localisation
            query = query.replace(/météo|temps|température/gi, '').trim();
            query = `météo ${query || 'france'} aujourd'hui`;
            break;
    }
    
    // Limiter à 8 mots maximum pour l'efficacité
    const words = query.split(' ').filter(word => word.length > 1).slice(0, 8);
    
    return words.join(' ');
}

// ✅ DÉTECTION D'INDICATEURS DE RECHERCHE
function containsSearchIndicators(message) {
    const searchIndicators = [
        /\b(cherche|recherche|trouve|informe|renseigne)\b/i,
        /\b(dernières?|récentes?|nouvelles?|actuelles?)\b/i,
        /\b(état|situation|condition|status)\b.*\b(actuel|maintenant)\b/i,
        /\b(que se passe|quoi de neuf|comment ça va)\b/i,
        /\b\d{4}\b/, // Années
        /\b(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\b/i
    ];
    
    return searchIndicators.some(pattern => pattern.test(message));
}

// ✅ RECHERCHE WEB FIABLE - NOUVELLE IMPLÉMENTATION
async function performReliableWebSearch(query, searchType = 'general', ctx) {
    const { log } = ctx;
    
    try {
        console.log('🔍 Démarrage recherche fiable pour:', query, `(type: ${searchType})`);
        
        // Vérifier le cache d'abord
        const cached = getCachedSearch(query);
        if (cached) {
            console.log('💾 Résultat trouvé en cache');
            return cached;
        }
        
        // 1. PRIORITÉ: Wikipedia (toujours fiable)
        const wikiResults = await searchWikipediaReliable(query, searchType);
        if (wikiResults && wikiResults.length > 0) {
            console.log('✅ Wikipedia réussi:', wikiResults.length, 'résultats');
            setCachedSearch(query, wikiResults);
            return wikiResults;
        }
        
        // 2. News API gratuite (actualités)
        if (searchType === 'news' || searchType === 'sports') {
            const newsResults = await searchWithNewsAPI(query);
            if (newsResults && newsResults.length > 0) {
                console.log('✅ News API réussi:', newsResults.length, 'résultats');
                setCachedSearch(query, newsResults);
                return newsResults;
            }
        }
        
        // 3. Reddit Search API (discussions récentes)
        const redditResults = await searchReddit(query, searchType);
        if (redditResults && redditResults.length > 0) {
            console.log('✅ Reddit réussi:', redditResults.length, 'résultats');
            setCachedSearch(query, redditResults);
            return redditResults;
        }
        
        // 4. OpenStreetMap pour géolocalisation
        if (searchType === 'weather' || containsLocation(query)) {
            const osmResults = await searchOpenStreetMap(query);
            if (osmResults && osmResults.length > 0) {
                console.log('✅ OpenStreetMap réussi:', osmResults.length, 'résultats');
                setCachedSearch(query, osmResults);
                return osmResults;
            }
        }
        
        // 5. FALLBACK: Scraping léger de moteurs de recherche
        const scrapedResults = await lightWebScraping(query, searchType);
        if (scrapedResults && scrapedResults.length > 0) {
            console.log('✅ Scraping léger réussi:', scrapedResults.length, 'résultats');
            setCachedSearch(query, scrapedResults);
            return scrapedResults;
        }
        
        log.warning('⚠️ Toutes les méthodes de recherche ont échoué pour:', query);
        return null;
        
    } catch (error) {
        log.error(`❌ Erreur recherche web: ${error.message}`);
        return null;
    }
}

// ✅ WIKIPEDIA RECHERCHE FIABLE (VERSION AMÉLIORÉE)
async function searchWikipediaReliable(query, searchType) {
    try {
        console.log('📚 Recherche Wikipedia améliorée pour:', query);
        
        // 1. Recherche directe par titre
        let searchUrl = `https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
        
        let response = await axios.get(searchUrl, {
            timeout: 8000,
            headers: {
                'User-Agent': 'NakamaBot/2.0 (Educational; https://example.com/contact)',
                'Accept': 'application/json'
            }
        });
        
        if (response.data && response.data.extract && !response.data.type?.includes('disambiguation')) {
            return formatWikipediaResult(response.data, 'fr');
        }
        
        // 2. Recherche par mots-clés si pas de résultat direct
        const searchApiUrl = `https://fr.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&srinfo=suggestion`;
        
        response = await axios.get(searchApiUrl, {
            timeout: 8000,
            headers: {
                'User-Agent': 'NakamaBot/2.0 (Educational; https://example.com/contact)'
            }
        });
        
        const searchData = response.data;
        if (searchData.query?.search?.length > 0) {
            // Prendre le premier résultat de recherche
            const firstResult = searchData.query.search[0];
            const pageTitle = firstResult.title;
            
            // Récupérer le résumé de cette page
            const summaryUrl = `https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
            const summaryResponse = await axios.get(summaryUrl, {
                timeout: 8000,
                headers: {
                    'User-Agent': 'NakamaBot/2.0 (Educational; https://example.com/contact)'
                }
            });
            
            if (summaryResponse.data?.extract) {
                return formatWikipediaResult(summaryResponse.data, 'fr');
            }
        }
        
        // 3. Essayer en anglais si français échoue
        const enSearchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
        const enResponse = await axios.get(enSearchUrl, {
            timeout: 8000,
            headers: {
                'User-Agent': 'NakamaBot/2.0 (Educational; https://example.com/contact)'
            }
        });
        
        if (enResponse.data?.extract) {
            return formatWikipediaResult(enResponse.data, 'en');
        }
        
        return null;
        
    } catch (error) {
        console.log('❌ Wikipedia échoué:', error.message);
        return null;
    }
}

// ✅ FORMATAGE RÉSULTATS WIKIPEDIA
function formatWikipediaResult(data, language) {
    const result = {
        title: data.title || 'Article Wikipedia',
        snippet: data.extract || '',
        url: data.content_urls?.desktop?.page || `https://${language}.wikipedia.org/wiki/${encodeURIComponent(data.title)}`,
        source: `Wikipedia ${language.toUpperCase()}`,
        type: 'encyclopedia',
        thumbnail: data.thumbnail?.source || null
    };
    
    // Limiter la taille du snippet
    if (result.snippet.length > 300) {
        result.snippet = result.snippet.substring(0, 297) + '...';
    }
    
    return [result];
}

// ✅ NEWS API GRATUITE (NewsAPI.org ou alternatives)
async function searchWithNewsAPI(query) {
    try {
        console.log('📰 Recherche actualités pour:', query);
        
        // Alternative gratuite: RSS feeds
        const rssFeeds = [
            'https://www.lemonde.fr/rss/une.xml',
            'https://www.franceinfo.fr/rss/',
            'https://rss.cnn.com/rss/edition.rss'
        ];
        
        for (const feedUrl of rssFeeds) {
            try {
                const response = await axios.get(feedUrl, {
                    timeout: 8000,
                    headers: {
                        'User-Agent': 'NakamaBot/2.0 (News Aggregator)'
                    }
                });
                
                const results = parseRSSFeed(response.data, query);
                if (results.length > 0) {
                    return results;
                }
            } catch (feedError) {
                console.log(`Échec RSS ${feedUrl}:`, feedError.message);
            }
        }
        
        return null;
        
    } catch (error) {
        console.error('❌ News API échoué:', error.message);
        return null;
    }
}

// ✅ PARSER RSS SIMPLE
function parseRSSFeed(xmlData, query) {
    try {
        // Parser XML simple (sans dépendance externe)
        const items = xmlData.match(/<item>[\s\S]*?<\/item>/gi) || [];
        const results = [];
        
        const queryWords = query.toLowerCase().split(' ').filter(w => w.length > 2);
        
        items.slice(0, 5).forEach(item => {
            const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i);
            const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/i);
            const linkMatch = item.match(/<link>(.*?)<\/link>/i);
            const dateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/i);
            
            const title = titleMatch ? (titleMatch[1] || titleMatch[2]) : '';
            const description = descMatch ? (descMatch[1] || descMatch[2]) : '';
            
            // Vérifier la pertinence
            const content = (title + ' ' + description).toLowerCase();
            const relevance = queryWords.filter(word => content.includes(word)).length / queryWords.length;
            
            if (relevance > 0.3 && title) { // Au moins 30% de mots-clés trouvés
                results.push({
                    title: title.replace(/<[^>]*>/g, ''),
                    snippet: description.replace(/<[^>]*>/g, '').substring(0, 200),
                    url: linkMatch ? linkMatch[1] : '',
                    source: 'Actualités RSS',
                    type: 'news',
                    date: dateMatch ? dateMatch[1] : null,
                    relevance: relevance
                });
            }
        });
        
        // Trier par pertinence
        return results.sort((a, b) => b.relevance - a.relevance).slice(0, 3);
        
    } catch (error) {
        console.error('Erreur parsing RSS:', error);
        return [];
    }
}

// ✅ RECHERCHE REDDIT (API PUBLIQUE)
async function searchReddit(query, searchType) {
    try {
        console.log('🔴 Recherche Reddit pour:', query);
        
        // API Reddit publique (sans authentification)
        const subreddits = getRelevantSubreddits(searchType);
        const searchUrl = `https://www.reddit.com/r/${subreddits}/search.json?q=${encodeURIComponent(query)}&sort=hot&limit=3&restrict_sr=1`;
        
        const response = await axios.get(searchUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'NakamaBot/2.0 (Web Search Bot)'
            }
        });
        
        const data = response.data;
        if (data?.data?.children?.length > 0) {
            return data.data.children.slice(0, 3).map(post => ({
                title: post.data.title,
                snippet: post.data.selftext.substring(0, 200) || `Discussion Reddit avec ${post.data.num_comments} commentaires`,
                url: `https://reddit.com${post.data.permalink}`,
                source: `r/${post.data.subreddit}`,
                type: 'discussion',
                score: post.data.score,
                comments: post.data.num_comments
            }));
        }
        
        return null;
        
    } catch (error) {
        console.log('❌ Reddit échoué:', error.message);
        return null;
    }
}

// ✅ SUBREDDITS PERTINENTS PAR TYPE
function getRelevantSubreddits(searchType) {
    const subredditMap = {
        'sports': 'soccer+football+sports+championship',
        'news': 'worldnews+news+france',
        'tech': 'technology+programming+tech',
        'financial': 'cryptocurrency+investing+finance',
        'general': 'todayilearned+explainlikeimfive+askreddit'
    };
    
    return subredditMap[searchType] || subredditMap['general'];
}

// ✅ OPENSTREETMAP POUR GÉOLOCALISATION
async function searchOpenStreetMap(query) {
    try {
        console.log('🗺️ Recherche OSM pour:', query);
        
        // API Nominatim d'OpenStreetMap (gratuite)
        const osmUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=3&addressdetails=1&extratags=1`;
        
        const response = await axios.get(osmUrl, {
            timeout: 8000,
            headers: {
                'User-Agent': 'NakamaBot/2.0 (Location Search)'
            }
        });
        
        const data = response.data;
        if (Array.isArray(data) && data.length > 0) {
            return data.slice(0, 2).map(location => ({
                title: location.display_name.split(',')[0],
                snippet: `Localisation: ${location.display_name}`,
                url: `https://www.openstreetmap.org/#map=15/${location.lat}/${location.lon}`,
                source: 'OpenStreetMap',
                type: 'location',
                coordinates: {
                    lat: parseFloat(location.lat),
                    lon: parseFloat(location.lon)
                }
            }));
        }
        
        return null;
        
    } catch (error) {
        console.log('❌ OpenStreetMap échoué:', error.message);
        return null;
    }
}

// ✅ SCRAPING LÉGER (DERNIER RECOURS)
async function lightWebScraping(query, searchType) {
    try {
        console.log('🕷️ Scraping léger pour:', query);
        
        // Utiliser DuckDuckGo HTML (scraping très léger)
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        
        const response = await axios.get(ddgUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; NakamaBot/2.0)',
                'Accept': 'text/html,application/xhtml+xml'
            }
        });
        
        // Parse HTML avec cheerio si disponible, sinon regex
        if (typeof cheerio !== 'undefined') {
            const $ = cheerio.load(response.data);
            const results = [];
            
            $('.result__body').each((i, element) => {
                if (i >= 3) return false; // Limiter à 3 résultats
                
                const $el = $(element);
                const title = $el.find('.result__title a').text().trim();
                const snippet = $el.find('.result__snippet').text().trim();
                const url = $el.find('.result__title a').attr('href');
                
                if (title && snippet) {
                    results.push({
                        title: title,
                        snippet: snippet.substring(0, 200),
                        url: url || '',
                        source: 'DuckDuckGo',
                        type: 'web'
                    });
                }
            });
            
            return results.length > 0 ? results : null;
        }
        
        // Fallback regex si cheerio indisponible
        const resultMatches = response.data.match(/class="result__body">[\s\S]*?(?=<div class="result__body">|$)/g) || [];
        const results = [];
        
        resultMatches.slice(0, 3).forEach(match => {
            const titleMatch = match.match(/class="result__title"[^>]*><a[^>]*>([^<]+)/);
            const snippetMatch = match.match(/class="result__snippet"[^>]*>([^<]+)/);
            
            if (titleMatch && snippetMatch) {
                results.push({
                    title: titleMatch[1].trim(),
                    snippet: snippetMatch[1].trim().substring(0, 200),
                    url: '',
                    source: 'DuckDuckGo Scraping',
                    type: 'web'
                });
            }
        });
        
        return results.length > 0 ? results : null;
        
    } catch (error) {
        console.log('❌ Scraping léger échoué:', error.message);
        return null;
    }
}

// ✅ VÉRIFICATION DE LOCALISATION DANS LA REQUÊTE
function containsLocation(query) {
    const locationIndicators = [
        /\b(ville|région|pays|france|paris|lyon|marseille|toulouse|bordeaux|lille|nantes|strasbourg|montpellier|nice|rennes)\b/i,
        /\b(météo|temps|température|climat)\b/i,
        /\b(où|localisation|position|adresse)\b/i
    ];
    
    return locationIndicators.some(pattern => pattern.test(query));
}

// ✅ CACHE AMÉLIORÉ AVEC TTL VARIABLE
const searchCache = new Map();

function getCachedSearch(query) {
    const cacheKey = query.toLowerCase().trim();
    const cached = searchCache.get(cacheKey);
    
    if (!cached) return null;
    
    // TTL variable selon le type de contenu
    const ttl = getTTLForQuery(query);
    if ((Date.now() - cached.timestamp) < ttl) {
        return cached.results;
    }
    
    // Supprimer si expiré
    searchCache.delete(cacheKey);
    return null;
}

function setCachedSearch(query, results) {
    const cacheKey = query.toLowerCase().trim();
    searchCache.set(cacheKey, {
        results,
        timestamp: Date.now(),
        query: cacheKey
    });
    
    // Nettoyage automatique si cache trop grand
    if (searchCache.size > 200) {
        const oldestKey = Array.from(searchCache.keys())[0];
        searchCache.delete(oldestKey);
    }
}

// ✅ TTL VARIABLE SELON LE TYPE DE REQUÊTE
function getTTLForQuery(query) {
    const lowerQuery = query.toLowerCase();
    
    // Actualités et sports: 10 minutes
    if (/\b(actualité|news|match|score|résultat|champion)\b/i.test(lowerQuery)) {
        return 10 * 60 * 1000;
    }
    
    // Données financières: 5 minutes
    if (/\b(bitcoin|cours|prix|bourse)\b/i.test(lowerQuery)) {
        return 5 * 60 * 1000;
    }
    
    // Météo: 30 minutes
    if (/\b(météo|temps|température)\b/i.test(lowerQuery)) {
        return 30 * 60 * 1000;
    }
    
    // Contenu encyclopédique: 4 heures
    return 4 * 60 * 60 * 1000;
}

// ✅ ANALYSE IA OPTIMISÉE
async function analyzeWithAI(message, ctx) {
    try {
        const analysisPrompt = `Analyse ce message et détermine s'il nécessite une recherche web récente.

Message: "${message}"

Réponds UNIQUEMENT par un JSON valide:
{
    "needsSearch": boolean,
    "query": "requête optimisée" ou null,
    "searchType": "news|sports|financial|weather|general" ou null,
    "reason": "explication courte"
}

Critères pour needsSearch=true:
- Questions sur événements récents/actualités
- Résultats sportifs récents
- Prix/cours actuels  
- Météo/conditions actuelles
- Informations qui changent fréquemment

Critères pour needsSearch=false:
- Définitions générales
- Conversations personnelles
- Questions théoriques/créatives
- Sujets intemporels`;

        // Essai avec Gemini d'abord
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            const result = await model.generateContent(analysisPrompt);
            const response = result.response.text();
            
            const jsonMatch = response.match(/\{[\s\S]*?\}/);
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
            
            const jsonMatch = mistralResponse.match(/\{[\s\S]*?\}/);
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

// ✅ GÉNÉRATION DE RÉPONSE ENRICHIE AVEC RECHERCHE
async function generateSearchEnhancedResponse(originalMessage, searchResults, ctx) {
    try {
        // Préparer le contexte de recherche avec scoring
        const scoredResults = scoreSearchResults(searchResults, originalMessage);
        const topResults = scoredResults.slice(0, 3);
        
        const searchContext = topResults.map((result, index) => 
            `[${index + 1}] ${result.title}: ${result.snippet} (Source: ${result.source})`
        ).join('\n');
        
        const enhancementPrompt = `Question utilisateur: "${originalMessage}"

Informations récentes trouvées:
${searchContext}

Génère une réponse naturelle et conversationnelle qui:
1. Répond directement à la question avec les infos récentes
2. Intègre naturellement les informations pertinentes
3. Reste amicale et accessible 
4. Maximum 2500 caractères
5. Commence par 🔍 pour indiquer l'usage de la recherche web
6. Mentionne les sources principales à la fin

Style: Conversationnel, informatif mais pas robotique.`;

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
            ], 2000, 0.7);
            
            if (mistralResponse) {
                return mistralResponse;
            }
        } catch (mistralError) {
            console.log('Mistral aussi en échec pour synthèse');
        }
        
        // Fallback simple mais informatif
        const bestResult = topResults[0];
        const fallbackResponse = `🔍 **${bestResult.title}**\n\n${bestResult.snippet}\n\n*Source: ${bestResult.source}*`;
        
        // Ajouter d'autres résultats si pertinents
        if (topResults.length > 1) {
            const additionalInfo = topResults.slice(1, 2).map(r => 
                `\n📌 **Complément**: ${r.snippet.substring(0, 100)}...`
            ).join('');
            return fallbackResponse + additionalInfo;
        }
        
        return fallbackResponse;
        
    } catch (error) {
        console.error('Erreur génération réponse enrichie:', error);
        return `🔍 J'ai trouvé des informations récentes : ${searchResults[0].snippet}\n\n*Source: ${searchResults[0].source}*`;
    }
}

// ✅ SCORING DES RÉSULTATS DE RECHERCHE
function scoreSearchResults(results, originalQuery) {
    const queryWords = originalQuery.toLowerCase()
        .split(' ')
        .filter(word => word.length > 2)
        .map(word => word.replace(/[^\w]/g, ''));
    
    return results.map(result => {
        let score = 0;
        const content = (result.title + ' ' + result.snippet).toLowerCase();
        
        // Score par pertinence des mots-clés
        queryWords.forEach(word => {
            if (content.includes(word)) {
                score += 2;
                // Bonus si dans le titre
                if (result.title.toLowerCase().includes(word)) {
                    score += 1;
                }
            }
        });
        
        // Bonus par type de résultat
        const typeBonus = {
            'featured': 5,
            'news': 4,
            'encyclopedia': 3,
            'sports': 3,
            'discussion': 2,
            'web': 1
        };
        score += typeBonus[result.type] || 0;
        
        // Bonus pour sources fiables
        if (result.source.includes('Wikipedia') || result.source.includes('News')) {
            score += 2;
        }
        
        // Malus pour snippet trop court
        if (result.snippet.length < 50) {
            score -= 1;
        }
        
        return { ...result, score };
    }).sort((a, b) => b.score - a.score);
}

// ✅ GESTION CONVERSATION AVEC FALLBACK (INCHANGÉE MAIS OPTIMISÉE)
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
- Parle selon la langue de l'utilisateur et du contexte
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

// ✅ FONCTIONS UTILITAIRES INCHANGÉES MAIS OPTIMISÉES

// Détection des demandes de contact admin
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

// Génération suggestion de contact
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

// Détection des intentions de commandes
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

// Exécution de commande depuis le chat
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

// Génération de réponse contextuelle
async function generateContextualResponse(originalMessage, commandResult, commandName, ctx) {
    if (typeof commandResult === 'object' && commandResult.type === 'image') {
        return commandResult;
    }
    
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const contextPrompt = `L'utilisateur a dit: "${originalMessage}"
J'ai exécuté /${commandName} avec résultat: "${commandResult}"

Génère une réponse naturelle et amicale (max 200 chars) qui présente le résultat de manière conversationnelle.`;

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

// ✅ NOUVELLES FONCTIONS DE MONITORING ET STATISTIQUES

// Statistiques de recherche avancées
const searchStats = {
    total: 0,
    successful: 0,
    cached: 0,
    bySource: {},
    byType: {},
    errors: [],
    responseTime: []
};

function updateSearchStats(source, type, success, responseTime, fromCache = false) {
    searchStats.total++;
    if (success) searchStats.successful++;
    if (fromCache) searchStats.cached++;
    
    searchStats.bySource[source] = (searchStats.bySource[source] || 0) + 1;
    searchStats.byType[type] = (searchStats.byType[type] || 0) + 1;
    
    if (responseTime) {
        searchStats.responseTime.push(responseTime);
        if (searchStats.responseTime.length > 100) {
            searchStats.responseTime.shift(); // Garder seulement les 100 derniers
        }
    }
    
    if (!success && searchStats.errors.length < 50) {
        searchStats.errors.push({
            timestamp: new Date().toISOString(),
            source,
            type,
            error: 'Search failed'
        });
    }
}

function getSearchStats() {
    const avgResponseTime = searchStats.responseTime.length > 0 
        ? Math.round(searchStats.responseTime.reduce((a, b) => a + b) / searchStats.responseTime.length)
        : 0;
    
    return {
        ...searchStats,
        successRate: searchStats.total > 0 ? (searchStats.successful / searchStats.total * 100).toFixed(1) + '%' : '0%',
        cacheRate: searchStats.total > 0 ? (searchStats.cached / searchStats.total * 100).toFixed(1) + '%' : '0%',
        avgResponseTime: avgResponseTime + 'ms',
        topSources: Object.entries(searchStats.bySource)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5),
        recentErrors: searchStats.errors.slice(-10)
    };
}

// Fonction de diagnostic des APIs
async function diagnoseAPIs() {
    const diagnosis = {
        wikipedia: false,
        reddit: false,
        osm: false,
        rss: false,
        gemini: !!process.env.GEMINI_API_KEY
    };
    
    // Test Wikipedia
    try {
        await axios.get('https://fr.wikipedia.org/api/rest_v1/page/summary/France', { timeout: 5000 });
        diagnosis.wikipedia = true;
    } catch (e) {
        console.log('Wikipedia indisponible');
    }
    
    // Test Reddit
    try {
        await axios.get('https://www.reddit.com/r/test.json?limit=1', { timeout: 5000 });
        diagnosis.reddit = true;
    } catch (e) {
        console.log('Reddit indisponible');
    }
    
    // Test OpenStreetMap
    try {
        await axios.get('https://nominatim.openstreetmap.org/search?format=json&q=Paris&limit=1', { timeout: 5000 });
        diagnosis.osm = true;
    } catch (e) {
        console.log('OpenStreetMap indisponible');
    }
    
    // Test RSS (Le Monde)
    try {
        await axios.get('https://www.lemonde.fr/rss/une.xml', { timeout: 5000 });
        diagnosis.rss = true;
    } catch (e) {
        console.log('RSS indisponible');
    }
    
    return diagnosis;
}

// ✅ EXPORTS POUR AUTRES MODULES
module.exports.detectCommandIntentions = detectCommandIntentions;
module.exports.executeCommandFromChat = executeCommandFromChat;
module.exports.detectContactAdminIntention = detectContactAdminIntention;
module.exports.performReliableWebSearch = performReliableWebSearch;
module.exports.getSearchStats = getSearchStats;
module.exports.diagnoseAPIs = diagnoseAPIs;

// ✅ INITIALISATION AMÉLIORÉE
(async function initialize() {
    console.log('🚀 NakamaBot Chat Enhanced v2.0 - Initialisation...');
    
    // Vérifier les clés API
    const missingKeys = [];
    if (!process.env.GEMINI_API_KEY) missingKeys.push('GEMINI_API_KEY');
    
    if (missingKeys.length > 0) {
        console.error('❌ Variables d\'environnement manquantes:', missingKeys.join(', '));
        console.log('📝 Obtenir Gemini API: https://makersuite.google.com/app/apikey');
    } else {
        console.log('✅ Configuration API validée');
    }
    
    // Diagnostic des APIs externes
    console.log('🔍 Diagnostic des APIs externes...');
    const diagnosis = await diagnoseAPIs();
    
    Object.entries(diagnosis).forEach(([api, status]) => {
        console.log(`${status ? '✅' : '❌'} ${api.toUpperCase()}: ${status ? 'Disponible' : 'Indisponible'}`);
    });
    
    const availableAPIs = Object.values(diagnosis).filter(Boolean).length;
    console.log(`📊 ${availableAPIs}/5 APIs disponibles`);
    
    if (availableAPIs >= 2) {
        console.log('🎯 Recherche web fiable activée');
    } else {
        console.log('⚠️ Recherche web limitée (peu d\'APIs disponibles)');
    }
    
    // Initialiser le nettoyage automatique du cache
    setInterval(() => {
        console.log(`🧹 Nettoyage cache: ${searchCache.size} entrées`);
        
        let cleaned = 0;
        for (const [key, value] of searchCache.entries()) {
            const ttl = getTTLForQuery(key);
            if ((Date.now() - value.timestamp) > ttl) {
                searchCache.delete(key);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            console.log(`🗑️ ${cleaned} entrées expirées supprimées`);
        }
    }, 15 * 60 * 1000); // Nettoyage toutes les 15 minutes
    
    console.log('🎯 NakamaBot prêt avec recherche web fiable v2.0 !');
    
    // Statistiques initiales
    console.log('📈 Monitoring des performances activé');
    console.log('💾 Cache intelligent avec TTL variable activé');
    console.log('🔄 Système de fallback multi-sources activé');
})();
