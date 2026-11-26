export function getProductImage(productName: string | undefined): string {
  const name = (productName || '').toLowerCase();

  // Pastelería Fina y Tartas
  if (name.includes('red velvet')) {
    return 'https://images.unsplash.com/photo-1586788680434-30d324b2d46f?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('tres leches')) {
    return 'https://images.unsplash.com/photo-1535141192574-5d4897c13136?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('lemon pie') || name.includes('limón') || name.includes('limon')) {
    return 'https://images.unsplash.com/photo-1519869325930-281384150729?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('frutos rojos') || name.includes('tarta de frutos') || name.includes('fresas') || name.includes('tarta de fresa')) {
    return 'https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('pastel de chocolate') || name.includes('selva negra') || name.includes('trufa') || name.includes('ganache')) {
    return 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('tarta')) {
    return 'https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('pastel')) {
    return 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600&auto=format&fit=crop&q=80';
  }

  // Postres Individuales
  if (name.includes('cheesecake')) {
    return 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('cupcake')) {
    return 'https://images.unsplash.com/photo-1576618148400-f54bed99fcfd?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('macaron')) {
    return 'https://images.unsplash.com/photo-1569864321398-356b27e8a94a?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('mousse')) {
    return 'https://images.unsplash.com/photo-1541783245831-57d6fb0926d3?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('tiramisú') || name.includes('tiramisu')) {
    return 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('turrón') || name.includes('turron')) {
    return 'https://images.unsplash.com/photo-1582293041079-7814c2f12063?w=600&auto=format&fit=crop&q=80';
  }

  // Repostería y Panadería
  if (name.includes('canela') || name.includes('cinnamon') || name.includes('rol')) {
    return 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('croissant') || name.includes('medialuna')) {
    return 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('galleta') || name.includes('cookie')) {
    return 'https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('brownie')) {
    return 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('alfajor')) {
    return 'https://images.unsplash.com/photo-1587314168485-3236d6710814?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('dona') || name.includes('donut')) {
    return 'https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('sandwich') || name.includes('sándwich')) {
    return 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=600&auto=format&fit=crop&q=80';
  }

  // Cafetería y Bebidas
  if (name.includes('capuccino')) {
    return 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('latte')) {
    return 'https://images.unsplash.com/photo-1577590835286-1cdd24c08fd7?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('espresso')) {
    return 'https://images.unsplash.com/photo-1510591509098-f4fdc6d0ff04?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('frappé') || name.includes('frappe')) {
    return 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('té') || name.includes('te ') || name.includes('infusión')) {
    return 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=600&auto=format&fit=crop&q=80';
  }
  if (name.includes('chocolate')) {
    return 'https://images.unsplash.com/photo-1542990253-0d0f5be5f0ed?w=600&auto=format&fit=crop&q=80';
  }

  return 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600&auto=format&fit=crop&q=80';
}