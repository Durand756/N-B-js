const Youtube = require('youtube-search-api');
const axios = require('axios');

/**
 * Commande /music - Recherche YouTube + tentative extraction audio avec fallback
 * @param {string} senderId
 * @param {string} args - Titre musique (même mal écrit)
 * @param {object} ctx
 */
module.exports = async function cmdMusic(senderId, args, ctx) {
    const { addToMemory, log } = ctx;

    if (!args.trim()) {
        return `🎵 Tape /music suivi du titre pour recevoir un lien YouTube ou audio (si possible) :
Exemples :
/music blinding lights
/music eminem lose yourself`;
    }

    const query = args.trim();

    try {
        // Recherche YouTube
        const results = await Youtube.GetListByKeyword(query, false, 1);

        if (!results.items || results.items.length === 0) {
            return `😢 Désolé, aucune vidéo trouvée pour "${query}". Essaie un autre titre.`;
        }

        const video = results.items[0];
        const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;

        // Enregistrer la requête utilisateur
        addToMemory(String(senderId), 'user', `/music ${query}`);

        // Tenter d'obtenir un lien audio via un service en ligne gratuit
        // Exemple avec yt1s.com endpoint (public, sans clé)
        // Ce endpoint ne garantit rien, on catch toute erreur silencieusement

        let audioUrl = null;
        try {
            // Cette URL est un exemple, l'API yt1s.com ne fournit pas d'API officielle documentée,
            // mais ils ont une route qu'on peut tenter d'appeler (à tester)
            // Tu peux remplacer par un autre service si tu trouves un endpoint stable
            const yt1sApi = `https://yt1s.com/api/ajaxSearch/index`;
            const params = new URLSearchParams();
            params.append('q', videoUrl);

            const response = await axios.post(yt1sApi, params.toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0',
                },
                timeout: 5000, // 5s timeout pour ne pas bloquer
            });

            // Le format de la réponse contient souvent des liens dans response.data.links.mp3 ou similaire
            if (response.data && response.data.links && response.data.links.mp3 && response.data.links.mp3.length) {
                audioUrl = response.data.links.mp3[0].url || null;
            }
        } catch (err) {
            log.debug(`Audio extraction failed, fallback to video link: ${err.message}`);
        }

        // Si audio dispo, envoyer audio, sinon envoyer lien YouTube
        if (audioUrl) {
            addToMemory(String(senderId), 'bot', `Audio envoyé : ${audioUrl}`);
            return {
                type: 'audio',
                url: audioUrl,
                caption: `🎶 Voici l'audio extrait pour "${query}"\n(Source: ${videoUrl})`
            };
        } else {
            addToMemory(String(senderId), 'bot', `Lien YouTube envoyé : ${videoUrl}`);
            return `🎶 Voici le lien YouTube pour "${query}" :
${videoUrl}

ℹ️ L'audio direct n'est pas disponible, mais tu peux écouter la musique ici en streaming.`;
        }
    } catch (error) {
        log.error(`Erreur /music: ${error.message}`);
        // Toujours renvoyer un message générique pour ne pas bloquer l'utilisateur
        return `⚠️ Oups, une erreur est survenue pendant la recherche. Essaie plus tard.`;
    }
};
