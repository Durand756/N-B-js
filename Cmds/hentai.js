/**
 * Commande /hentai - Génération de contenu +18
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Description ou mot-clé (ex: "elfe", "tentacle", etc.) suivi de "j'accepte"
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdHentai(senderId, args, ctx) {
    const { addToMemory, log } = ctx;

    if (!args.toLowerCase().includes("j'accepte")) {
        return `🚫 Contenu réservé aux adultes (+18) !
🔞 Pour recevoir une image NSFW hentai, tu dois confirmer que tu es majeur(e) en tapant :

👉 /hentai [description ou vide] j'accepte

✅ Exemple : /hentai elfe magique j'accepte
📌 Tu peux aussi laisser vide pour une image aléatoire.

💡 Tu peux utiliser des mots-clés comme "tentacle", "maid", "elf", etc.
❓ Tape /help pour découvrir toutes les commandes disponibles.`;
    }

    try {
        const consentPrompt = args.replace(/j'?accepte/gi, '').trim();
        const senderIdStr = String(senderId);

        // Choix aléatoire si pas de prompt
        let imageUrl;
        if (!consentPrompt) {
            const res = await fetch("https://nekobot.xyz/api/image?type=hentai");
            const data = await res.json();
            imageUrl = data.message;
        } else {
            // Cas avec prompt → on utilise un moteur NSFW libre style "prompt API"
            const encodedPrompt = encodeURIComponent(consentPrompt);
            const seed = Math.floor(Math.random() * 1000000);
            imageUrl = `https://image.pollinations.ai/prompt/nsfw+anime+${encodedPrompt}?width=768&height=768&seed=${seed}&nologo=true`;
        }

        // Sauvegarde en mémoire
        addToMemory(senderIdStr, 'user', `Commande hentai: ${args}`);
        addToMemory(senderIdStr, 'bot', `Image hentai générée`);

        return {
            type: "image",
            url: imageUrl,
            caption: `🔞 Voici ton image NSFW générée à ta demande.
📝 ${consentPrompt ? `"${consentPrompt}"` : "Image aléatoire"}
📛 Rappelle-toi : ne partage cela qu'avec consentement.`
        };
    } catch (error) {
        log.error(`❌ Erreur hentai: ${error.message}`);
        return `💥 Une erreur est survenue lors de la génération NSFW.
Réessaie dans quelques secondes ou vérifie ta connexion.`;
    }
};
