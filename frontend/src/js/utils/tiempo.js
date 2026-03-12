const actualizarReloj = () =>{
    const hora = new Date();
    const stringTiempo = hora.toLocaleTimeString('en-US'); 
    document.getElementById('tiempo').textContent = stringTiempo
} 

setInterval(actualizarReloj, 1000) 
actualizarReloj()