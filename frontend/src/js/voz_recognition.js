const voiceBtn = document.getElementById('voice-search-btn');
const input = document.getElementById('barcode-input');
const form = document.getElementById('search-form');

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition && voiceBtn) {
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.interimResults = true; // show partial transcripts

    voiceBtn.addEventListener('click', () => {
        try {
            recognition.start();
            // Feedback táctil (vibración corta de 50ms)
            if (navigator.vibrate) navigator.vibrate(50);
        } catch (e) {
            console.log("Ya está escuchando...");
        }
    });

    // Cuando empieza a escuchar
    recognition.onstart = () => {
        voiceBtn.classList.add('mic-active', 'listening');
        voiceBtn.setAttribute('aria-pressed', 'true');
        input.placeholder = "Escuchando...";
    };

    // Cuando termina (ya sea por éxito o error)
    recognition.onend = () => {
        voiceBtn.classList.remove('mic-active', 'listening');
        voiceBtn.setAttribute('aria-pressed', 'false');
        input.placeholder = "Escanea el Código de Barras o escribe...";
    };

    recognition.onresult = (event) => {
        // utilizar el último resultado reconocido (provisional o final)
        const lastResult = event.results[event.results.length - 1];
        const transcript = (lastResult[0].transcript || '').trim();
        if (!transcript) return;

        if (!lastResult.isFinal) {
            // mostrar texto provisional en el placeholder mientras habla
            input.placeholder = transcript;
            return;
        }

        // resultado definitivo
        input.value = transcript;
        input.placeholder = "Escanea el Código de Barras o escribe...";

        // Efecto visual de éxito antes de enviar
        input.classList.add('border-green-500');
        setTimeout(() => {
            form.requestSubmit();
        }, 300);
    };
} else if (voiceBtn) {
    // si no hay reconocimiento de voz se oculta el botón
    voiceBtn.style.display = 'none';
}