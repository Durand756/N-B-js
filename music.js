/**
 * Commande /music - Recherche & Téléchargement d'une musique
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Titre (même mal écrit) de la musique
 * @param {object} ctx - Contexte du bot
 */
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const sanitize = require('sanitize-filename');

module.exports = async function cmdMusic(senderId, args, ctx) {
    const { addToMemory, log } = ctx;

    if (!args.trim()) {
        return `🎵 Tu veux une chanson ? Tape simplement : /music [titre]
Exemples :
• /music bleind light
• /music emeinem loose your self
• /music shakira wakka wakka`;
    }

    const query = args.trim();
    const safeQuery = sanitize(query).replace(/\s+/g, '_');
    const tempPath = path.join(__dirname, '..', 'downloads', `${safeQuery}_${Date.now()}.mp3`);

    // Étape 1 : Télécharger l’audio avec yt-dlp (YouTube audio uniquement)
    const command = `yt-dlp -x --audio-format mp3 --audio-quality 0 "ytsearch1:${query}" -o "${tempPath}"`;

    try {
        await new Promise((resolve, reject) => {
            exec(command, { timeout: 30000 }, (err, stdout, stderr) => {
                if (err) {
                    log.debug(`❌ Erreur yt-dlp: ${stderr || err.message}`);
                    return reject("💥 Erreur pendant le téléchargement de la musique.");
                }
                return resolve();
            });
        });

        // Étape 2 : Ajouter à la mémoire
        addToMemory(String(senderId), 'user', `/music ${query}`);
        addToMemory(String(senderId), 'bot', `Musique téléchargée: ${query}`);

        // Étape 3 : Retourner le chemin du fichier (à adapter selon ton bot)
        return {
            type: "audio",
            filePath: tempPath, // Ton bot Facebook doit prendre ce fichier et l'envoyer
            caption: `🎶 Voici ta musique : "${query}"\n✅ Générée avec amour et yt-dlp.`
        };
    } catch (error) {
        return `😢 Oups ! Je n'ai pas pu trouver cette chanson : "${query}". Essaie avec un autre titre.`;
    }
};
