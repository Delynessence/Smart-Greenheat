// Smooth scrolling untuk link navigasi
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Form submission
document.querySelector('.contact-form form')?.addEventListener('submit', function(e) {
    e.preventDefault();

    // Ambil data form
    const name = this.querySelector('input[type="text"]').value;
    const email = this.querySelector('input[type="email"]').value;
    const message = this.querySelector('textarea').value;

    // Tampilkan pesan sukses
    alert('Terima kasih! Pesan Anda telah terkirim.');

    // Reset form
    this.reset();
});

// Animation on scroll
const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.1
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('animate');
        }
    });
}, observerOptions);

// Observe elements
document.querySelectorAll('.feature-card, .about-content, .contact-content').forEach(el => {
    observer.observe(el);
});

// Tambahkan animasi ke CSS
const style = document.createElement('style');
style.textContent = `
    .feature-card, .about-content, .contact-content {
        opacity: 0;
        transform: translateY(30px);
        transition: opacity 0.6s ease, transform 0.6s ease;
    }

    .feature-card.animate, .about-content.animate, .contact-content.animate {
        opacity: 1;
        transform: translateY(0);
    }
`;
document.head.appendChild(style);

// --- Kode Slider Hero Section yang Telah Diperbaiki ---
(function() {
    const sliderContainer = document.querySelector('.slider-container');
    if (!sliderContainer) return;

    const sliderWrapper = sliderContainer.querySelector('.slider-wrapper');
    const slides = sliderContainer.querySelectorAll('.slide');
    const dots = sliderContainer.querySelectorAll('.slider-dots .dot');
    const prevBtn = sliderContainer.querySelector('.slider-prev');
    const nextBtn = sliderContainer.querySelector('.slider-next');

    let currentSlide = 0;
    let slideInterval = null;
    const SLIDE_INTERVAL = 3500; // 3.5 detik

    // Fungsi untuk menampilkan slide
    function showSlide(index) {
        // Geser slider menggunakan transform
        sliderWrapper.style.transform = `translateX(-${index * 100}%)`;

        // Reset semua dot
        dots.forEach(dot => {
            dot.classList.remove('active');
        });

        // Aktifkan dot yang sesuai
        dots[index].classList.add('active');

        currentSlide = index;
    }

    // Fungsi untuk slide berikutnya
    function nextSlide() {
        let next = (currentSlide + 1) % slides.length;
        showSlide(next);
    }

    // Fungsi untuk slide sebelumnya
    function prevSlide() {
        let prev = (currentSlide - 1 + slides.length) % slides.length;
        showSlide(prev);
    }

    // Fungsi untuk memulai slider otomatis
    function startSlider() {
        slideInterval = setInterval(nextSlide, SLIDE_INTERVAL);
    }

    // Fungsi untuk menghentikan slider otomatis
    function stopSlider() {
        clearInterval(slideInterval);
    }

    // Event listener untuk tombol next
    if (nextBtn) {
        nextBtn.addEventListener('click', function() {
            nextSlide();
            stopSlider();
            startSlider(); // Restart timer
        });
    }

    // Event listener untuk tombol prev
    if (prevBtn) {
        prevBtn.addEventListener('click', function() {
            prevSlide();
            stopSlider();
            startSlider(); // Restart timer
        });
    }

    // Event listener untuk dot indicators
    dots.forEach((dot, index) => {
        dot.addEventListener('click', function() {
            showSlide(index);
            stopSlider();
            startSlider(); // Restart timer
        });
    });

    // Pause slider saat mouse hover
    sliderContainer.addEventListener('mouseenter', stopSlider);
    sliderContainer.addEventListener('mouseleave', startSlider);

    // Inisialisasi slider
    showSlide(0);
    startSlider();
})();

// --- Kode Slider About Section ---
(function() {
    const sliderContainer = document.querySelector('.about-slider-container');
    if (!sliderContainer) return;

    const sliderWrapper = sliderContainer.querySelector('.about-slider-wrapper');
    const slides = sliderContainer.querySelectorAll('.about-slide');
    const dots = sliderContainer.querySelectorAll('.slider-dots-about .dot');
    const prevBtn = sliderContainer.querySelector('.slider-prev-about');
    const nextBtn = sliderContainer.querySelector('.slider-next-about');
    
    let currentSlide = 0;
    let slideInterval = null;
    const SLIDE_INTERVAL = 5000; // 5 detik
    
    // Fungsi untuk menampilkan slide
    function showSlide(index) {
        // Geser slide menggunakan transform
        sliderWrapper.style.transform = `translateX(-${index * 100}%)`;
        
        // Reset semua dot
        dots.forEach(dot => {
            dot.classList.remove('active');
        });
        
        // Aktifkan dot yang sesuai
        dots[index].classList.add('active');
        
        currentSlide = index;
    }
    
    // Fungsi untuk slide berikutnya
    function nextSlide() {
        let next = (currentSlide + 1) % slides.length;
        showSlide(next);
    }
    
    // Fungsi untuk slide sebelumnya
    function prevSlide() {
        let prev = (currentSlide - 1 + slides.length) % slides.length;
        showSlide(prev);
    }
    
    // Fungsi untuk memulai slider otomatis
    function startSlider() {
        slideInterval = setInterval(nextSlide, SLIDE_INTERVAL);
    }
    
    // Fungsi untuk menghentikan slider otomatis
    function stopSlider() {
        clearInterval(slideInterval);
    }
    
    // Event listener untuk tombol next
    if (nextBtn) {
        nextBtn.addEventListener('click', function() {
            nextSlide();
            stopSlider();
            startSlider(); // Restart timer
        });
    }
    
    // Event listener untuk tombol prev
    if (prevBtn) {
        prevBtn.addEventListener('click', function() {
            prevSlide();
            stopSlider();
            startSlider(); // Restart timer
        });
    }
    
    // Event listener untuk dot indicators
    dots.forEach((dot, index) => {
        dot.addEventListener('click', function() {
            showSlide(index);
            stopSlider();
            startSlider(); // Restart timer
        });
    });
    
    // Pause slider saat mouse hover
    sliderContainer.addEventListener('mouseenter', stopSlider);
    sliderContainer.addEventListener('mouseleave', startSlider);
    
    // Inisialisasi slider
    showSlide(0);
    startSlider();
})();