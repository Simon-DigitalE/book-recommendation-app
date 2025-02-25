import React, { useState, useEffect, useRef, useCallback } from 'react';
import _ from 'lodash';

// Digital Entrepreneur brand colors
const colors = {
  primary: {
    midnightBlue: '#1A2238',
    blue: '#4B65AD',
    lightGrey: '#F2F5F9',
    white: '#FFFFFF',
    coolGradient: 'linear-gradient(to bottom right, #D8E0F8, #94D7D9)'
  },
  secondary: {
    teal: '#53A6AB',
    purple: '#9858A9',
    rose: '#BB5D6E',
    yellow: '#DFAC09',
    grey: '#62697E'
  }
};

/* ----------------------------- Custom Hooks ----------------------------- */

// useRemoteStorage simulates remote persistence for user books.
function useRemoteStorage() {
  const getBooks = async () => {
    try {
      const res = await fetch('https://example.com/api/books');
      if (!res.ok) throw new Error('Failed to fetch remote books');
      const data = await res.json();
      return data.books;
    } catch (error) {
      console.error(error);
      return null; // fallback to local storage
    }
  };

  const setBooks = async (books: any[]) => {
    try {
      const res = await fetch('https://example.com/api/books', {
        method: 'POST', // or PUT
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ books })
      });
      if (!res.ok) throw new Error('Failed to sync books remotely');
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  };

  return { getBooks, setBooks };
}

// useUserBooks manages the user’s book list with remote sync and local fallback.
function useUserBooks() {
  const [userBooks, setUserBooks] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { getBooks, setBooks } = useRemoteStorage();

  // Load books from remote storage on mount; fallback to localStorage.
  useEffect(() => {
    async function loadBooks() {
      const remoteBooks = await getBooks();
      if (remoteBooks) {
        setUserBooks(remoteBooks);
        localStorage.setItem('userBooks', JSON.stringify(remoteBooks));
      } else {
        const savedBooks = localStorage.getItem('userBooks');
        if (savedBooks) {
          try {
            setUserBooks(JSON.parse(savedBooks));
          } catch (e) {
            setError('Failed to load books from local storage.');
          }
        }
      }
    }
    loadBooks();
  }, [getBooks]);

  // Sync userBooks to remote storage whenever they change.
  useEffect(() => {
    if (userBooks.length > 0) {
      localStorage.setItem('userBooks', JSON.stringify(userBooks));
      setBooks(userBooks).catch(() => {
        setError('Remote sync failed, changes saved locally.');
      });
    }
  }, [userBooks, setBooks]);

  const addBook = (book: any) => {
    setUserBooks(prev => [...prev, book]);
  };

  const removeBook = (id: number) => {
    setUserBooks(prev => prev.filter(b => b.id !== id));
  };

  return { userBooks, addBook, removeBook, error };
}

// useGoogleBooks handles Google Books API calls (with caching and error handling).
function useGoogleBooks() {
  const [localCache, setLocalCache] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchBooks = useCallback(async (query: string, type = 'title') => {
    setLoading(true);
    setError(null);
    const cacheKey = `${type}:${query.toLowerCase()}`;
    if (localCache[cacheKey]) {
      setLoading(false);
      return localCache[cacheKey];
    }
    try {
      const apiKey = process.env.REACT_APP_GOOGLE_BOOKS_API_KEY;
      let apiQuery = `https://www.googleapis.com/books/v1/volumes?q=`;
      if (type === 'title') {
        apiQuery += `intitle:${encodeURIComponent(query)}`;
      } else if (type === 'author') {
        apiQuery += `inauthor:${encodeURIComponent(query)}`;
      }
      apiQuery += `&maxResults=5&key=${apiKey}`;

      const response = await fetch(apiQuery);
      if (!response.ok) throw new Error('Google Books API request failed');
      const data = await response.json();

      let results: any[] = [];
      if (data.items && data.items.length > 0) {
        results = data.items.map((item: any) => {
          const volumeInfo = item.volumeInfo || {};
          const categories = volumeInfo.categories || [];
          return {
            id: item.id,
            title: volumeInfo.title || 'Unknown Title',
            author: volumeInfo.authors ? volumeInfo.authors.join(', ') : 'Unknown Author',
            genre: categories.length > 0 ? categories[0] : 'Unknown',
            features: [...categories, volumeInfo.language || 'english'],
            description: volumeInfo.description || 'No synopsis available',
            coverImage: volumeInfo.imageLinks ? volumeInfo.imageLinks.thumbnail : null
          };
        });
      }
      setLocalCache(prev => ({ ...prev, [cacheKey]: results }));
      setLoading(false);
      return results;
    } catch (err: any) {
      console.error(err);
      setError(err.message);
      setLoading(false);
      return [];
    }
  }, [localCache]);

  return { searchBooks, loading, error, localCache, setLocalCache };
}

/* ---------------------------- Modular Components ---------------------------- */

// BookForm – handles book entry with autocomplete suggestions.
function BookForm({ onAddBook, googleBooksHook, bookDatabase, addBookToDatabase }: {
  onAddBook: (book: any) => void;
  googleBooksHook: any;
  bookDatabase: any[];
  addBookToDatabase: (book: any) => void;
}) {
  const { searchBooks, loading: searchLoading, error: googleError } = googleBooksHook;
  const [newBookTitle, setNewBookTitle] = useState('');
  const [newBookAuthor, setNewBookAuthor] = useState('');
  const [newBookRating, setNewBookRating] = useState(5);
  const [titleSuggestions, setTitleSuggestions] = useState<any[]>([]);
  const [authorSuggestions, setAuthorSuggestions] = useState<string[]>([]);
  const [showTitleSuggestions, setShowTitleSuggestions] = useState(false);
  const [showAuthorSuggestions, setShowAuthorSuggestions] = useState(false);
  const titleInputRef = useRef<HTMLDivElement>(null);
  const authorInputRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<any>(null);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setNewBookTitle(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (value.trim().length > 2) {
      // Local database search for suggestions.
      const localResults = bookDatabase.filter(book =>
        book.title.toLowerCase().includes(value.toLowerCase())
      ).map(book => ({ title: book.title, author: book.author, description: book.description, coverImage: book.coverImage, id: book.id }));
      if (localResults.length > 0) {
        setTitleSuggestions(localResults.slice(0, 5));
        setShowTitleSuggestions(true);
      }
      // Debounced API search.
      searchTimeoutRef.current = setTimeout(async () => {
        const apiResults = await searchBooks(value, 'title');
        const combinedResults = _.uniqBy(
          [...localResults, ...apiResults.map((book: any) => ({
            title: book.title,
            author: book.author,
            coverImage: book.coverImage,
            id: book.id,
            description: book.description
          }))],
          'title'
        ).slice(0, 5);
        setTitleSuggestions(combinedResults);
        setShowTitleSuggestions(true);
      }, 300);
    } else {
      setTitleSuggestions([]);
      setShowTitleSuggestions(false);
    }
  };

  const handleAuthorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setNewBookAuthor(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (value.trim().length > 2) {
      const localResults = _.uniq(bookDatabase
        .filter(book => book.author.toLowerCase().includes(value.toLowerCase()))
        .map(book => book.author)
      );
      if (localResults.length > 0) {
        setAuthorSuggestions(localResults.slice(0, 5));
        setShowAuthorSuggestions(true);
      }
      searchTimeoutRef.current = setTimeout(async () => {
        const apiResults = await searchBooks(value, 'author');
        const apiAuthors = _.uniq(apiResults.map((book: any) => book.author));
        const combinedResults = _.uniq([...localResults, ...apiAuthors]).slice(0, 5);
        setAuthorSuggestions(combinedResults);
        setShowAuthorSuggestions(true);
      }, 300);
    } else {
      setAuthorSuggestions([]);
      setShowAuthorSuggestions(false);
    }
  };

  const selectTitleSuggestion = (suggestion: any) => {
    setNewBookTitle(suggestion.title);
    setNewBookAuthor(suggestion.author);
    setShowTitleSuggestions(false);
    if (suggestion.id) {
      const exists = bookDatabase.findIndex(book => book.title.toLowerCase() === suggestion.title.toLowerCase());
      if (exists === -1) {
        addBookToDatabase({
          id: suggestion.id,
          title: suggestion.title,
          author: suggestion.author,
          features: suggestion.features || [],
          genre: suggestion.genre || 'Unknown',
          coverImage: suggestion.coverImage || null,
          description: suggestion.description
        });
      }
    }
    if (!suggestion.author) {
      authorInputRef.current?.focus();
    }
  };

  const selectAuthorSuggestion = (author: string) => {
    setNewBookAuthor(author);
    setShowAuthorSuggestions(false);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (titleInputRef.current && !titleInputRef.current.contains(e.target as Node)) {
        setShowTitleSuggestions(false);
      }
      if (authorInputRef.current && !authorInputRef.current.contains(e.target as Node)) {
        setShowAuthorSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAddBook = async () => {
    if (newBookTitle.trim() === '') return;
    // Check local database first.
    let foundBook = bookDatabase.find(
      book => book.title.toLowerCase() === newBookTitle.toLowerCase()
    );
    if (!foundBook) {
      const apiResults = await searchBooks(newBookTitle, 'title');
      const bestMatch = apiResults.find((book: any) =>
        book.title.toLowerCase() === newBookTitle.toLowerCase()
      ) || apiResults[0];
      if (bestMatch) {
        foundBook = {
          id: bestMatch.id,
          title: bestMatch.title,
          author: bestMatch.author,
          features: bestMatch.features || [],
          genre: bestMatch.genre || 'Unknown',
          coverImage: bestMatch.coverImage || null,
          description: bestMatch.description
        };
        addBookToDatabase(foundBook);
      }
    }
    const newBook = {
      id: Date.now(),
      title: newBookTitle,
      author: newBookAuthor || 'Unknown Author',
      rating: newBookRating,
      features: foundBook ? foundBook.features : [],
      genre: foundBook ? foundBook.genre : 'Unknown',
      coverImage: foundBook ? foundBook.coverImage : null,
      description: foundBook ? foundBook.description : 'No synopsis available'
    };
    onAddBook(newBook);
    setNewBookTitle('');
    setNewBookAuthor('');
    setNewBookRating(5);
    setShowTitleSuggestions(false);
    setShowAuthorSuggestions(false);
  };

  return (
    <div className="mb-8 p-4 bg-white rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4">Add Books You've Read</h2>
      {googleError && <p className="text-red-500">Google Books Error: {googleError}</p>}
      <div className="flex flex-col space-y-4">
        <div ref={titleInputRef} className="relative">
          <label className="block text-sm font-medium text-gray-700">Book Title</label>
          <input
            type="text"
            value={newBookTitle}
            onChange={handleTitleChange}
            className="mt-1 p-2 w-full border rounded-md"
            placeholder="Enter book title"
          />
          {showTitleSuggestions && (
            <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-auto">
              {searchLoading && titleSuggestions.length === 0 && (
                <div className="p-2 text-gray-500">Searching...</div>
              )}
              {titleSuggestions.length > 0 ? (
                titleSuggestions.map((suggestion, index) => (
                  <div
                    key={index}
                    className="p-2 hover:bg-gray-100 cursor-pointer flex items-center"
                    onClick={() => selectTitleSuggestion(suggestion)}
                  >
                    {suggestion.coverImage && (
                      <img 
                        src={suggestion.coverImage} 
                        alt=""
                        className="h-12 w-8 mr-2 object-cover"
                        onError={(e) => {e.currentTarget.style.display = 'none'}}
                      />
                    )}
                    <div>
                      <div className="font-medium">{suggestion.title}</div>
                      {suggestion.author && (
                        <div className="text-sm text-gray-600">by {suggestion.author}</div>
                      )}
                    </div>
                  </div>
                ))
              ) : !searchLoading && (
                <div className="p-2 text-gray-500">No matching books found</div>
              )}
            </div>
          )}
        </div>
        <div ref={authorInputRef} className="relative">
          <label className="block text-sm font-medium text-gray-700">Author (optional)</label>
          <input
            type="text"
            value={newBookAuthor}
            onChange={handleAuthorChange}
            className="mt-1 p-2 w-full border rounded-md"
            placeholder="Enter author name"
          />
          {showAuthorSuggestions && (
            <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-auto">
              {searchLoading && authorSuggestions.length === 0 && (
                <div className="p-2 text-gray-500">Searching...</div>
              )}
              {authorSuggestions.length > 0 ? (
                authorSuggestions.map((author, index) => (
                  <div
                    key={index}
                    className="p-2 hover:bg-gray-100 cursor-pointer"
                    onClick={() => selectAuthorSuggestion(author)}
                  >
                    {author}
                  </div>
                ))
              ) : !searchLoading && (
                <div className="p-2 text-gray-500">No matching authors found</div>
              )}
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Your Rating (1-5)</label>
          <div className="flex items-center mt-1">
            {[1, 2, 3, 4, 5].map(star => (
              <button
                key={star}
                type="button"
                onClick={() => setNewBookRating(star)}
                className={`h-8 w-8 ${star <= newBookRating ? 'text-yellow-400' : 'text-gray-300'}`}
              >
                ★
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={handleAddBook}
          className="bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700"
        >
          Add Book
        </button>
      </div>
    </div>
  );
}

// BookList – displays the list of books the user has added.
function BookList({ userBooks, onRemoveBook }: { userBooks: any[]; onRemoveBook: (id: number) => void }) {
  return (
    <div className="mb-8 p-4 bg-white rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4" style={{ 
          color: colors.primary.midnightBlue,
          fontFamily: 'Cabin, sans-serif',
          fontWeight: 700
        }}>Your Books</h2>
      {userBooks.length === 0 ? (
        <p style={{ 
          color: colors.secondary.grey,
          fontFamily: 'Cabin, sans-serif'
        }}>You haven't added any books yet.</p>
      ) : (
        <div className="space-y-4">
          {userBooks.map(book => (
            <div key={book.id} className="flex justify-between items-center p-3 border rounded-md" style={{ borderColor: colors.primary.lightGrey }}>
              <div className="flex">
                {book.coverImage && (
                  <img 
                    src={book.coverImage} 
                    alt="" 
                    className="h-16 w-12 mr-3 object-cover"
                    onError={(e) => {e.currentTarget.style.display = 'none'}}
                  />
                )}
                <div>
                  <h3 className="font-medium" style={{ 
                    color: colors.primary.midnightBlue,
                    fontFamily: 'Cabin, sans-serif'
                  }}>{book.title}</h3>
                  <p className="text-sm" style={{ 
                    color: colors.secondary.grey,
                    fontFamily: 'Cabin, sans-serif'
                  }}>by {book.author}</p>
                  <p className="text-xs" style={{ 
                    color: colors.secondary.grey,
                    fontFamily: 'Cabin, sans-serif'
                  }}>{book.genre || 'Unknown genre'}</p>
                  <div className="flex" style={{ color: colors.secondary.yellow }}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <span key={i}>{i < book.rating ? '★' : '☆'}</span>
                    ))}
                  </div>
                </div>
              </div>
              <button
                onClick={() => onRemoveBook(book.id)}
                className="hover:opacity-80"
                style={{ 
                  color: colors.secondary.rose,
                  fontFamily: 'Cabin, sans-serif',
                  fontWeight: 500
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// StatsDashboard – displays reading statistics.
function StatsDashboard({ userBooks }: { userBooks: any[] }) {
  const totalBooks = userBooks.length;
  const averageRating = totalBooks ? (userBooks.reduce((sum, book) => sum + book.rating, 0) / totalBooks).toFixed(1) : 0;
  const topGenre = (() => {
    const genres = userBooks.map(book => book.genre).filter(g => g && g !== 'Unknown');
    const counts = _.countBy(genres);
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0] ? sorted[0][0] : 'N/A';
  })();

  return (
    <div className="mb-8 p-4 bg-white rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4">Your Reading Stats</h2>
      {totalBooks === 0 ? (
        <p className="text-gray-500">Add some books to see your stats.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3 bg-blue-50 rounded-lg">
            <h3 className="text-lg font-medium text-blue-700">Total Books</h3>
            <p className="text-3xl font-bold text-blue-900">{totalBooks}</p>
          </div>
          <div className="p-3 bg-green-50 rounded-lg">
            <h3 className="text-lg font-medium text-green-700">Average Rating</h3>
            <p className="text-3xl font-bold text-green-900">{averageRating}</p>
          </div>
          <div className="p-3 bg-purple-50 rounded-lg">
            <h3 className="text-lg font-medium text-purple-700">Top Genre</h3>
            <p className="text-3xl font-bold text-purple-900">{topGenre}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// RecommendationList – shows recommended books with synopses and feedback buttons.
function RecommendationList({ recommendations, onAddBook, onFeedback }: { 
  recommendations: { data: any[], loading: boolean, userBooksEmpty: boolean }; 
  onAddBook: (book: any) => void;
  onFeedback: (bookId: number, type: 'like' | 'dislike') => void;
}) {
  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4" style={{ 
          color: colors.primary.midnightBlue,
          fontFamily: 'Cabin, sans-serif',
          fontWeight: 700
        }}>Recommended Books</h2>
      {recommendations.loading ? (
        <p style={{ color: colors.secondary.grey, fontFamily: 'Cabin, sans-serif' }}>
          Generating recommendations...
        </p>
      ) : recommendations.data.length === 0 ? (
        <p style={{ color: colors.secondary.grey, fontFamily: 'Cabin, sans-serif' }}>
          {recommendations.userBooksEmpty
            ? "Add some books you've read to get recommendations"
            : "No recommendations found based on your preferences"}
        </p>
      ) : (
        <div className="space-y-4">
          {recommendations.data.map(book => (
            <div key={book.id} className="p-3 border rounded-md flex" style={{ borderColor: colors.primary.lightGrey }}>
              {book.coverImage && (
                <img 
                  src={book.coverImage} 
                  alt="" 
                  className="h-24 w-16 mr-3 object-cover"
                  onError={(e) => {e.currentTarget.style.display = 'none'}}
                />
              )}
              <div>
                <h3 className="font-medium" style={{ 
                    color: colors.primary.midnightBlue,
                    fontFamily: 'Cabin, sans-serif'
                  }}>{book.title}</h3>
                <p className="text-sm" style={{ 
                    color: colors.secondary.grey,
                    fontFamily: 'Cabin, sans-serif'
                  }}>by {book.author}</p>
                <p className="text-sm" style={{ 
                    color: colors.secondary.grey,
                    fontFamily: 'Cabin, sans-serif'
                  }}>Genre: {book.genre}</p>
                <p className="text-xs mt-2" style={{ 
                    color: colors.secondary.grey,
                    fontFamily: 'Cabin, sans-serif'
                  }}>{book.description}</p>
                <div className="mt-2 flex items-center">
                  <span className="text-xs px-2 py-1 rounded-full" style={{ 
                    backgroundColor: colors.primary.lightGrey,
                    color: colors.primary.blue,
                    fontFamily: 'Cabin, sans-serif'
                  }}>
                    Match score: {book.score}
                  </span>
                  <button
                    onClick={() => onAddBook(book)}
                    className="ml-4 mt-2 text-sm py-1 px-2 rounded-md hover:opacity-90"
                    style={{ 
                      backgroundColor: colors.secondary.teal,
                      color: colors.primary.white,
                      fontFamily: 'Cabin, sans-serif',
                      fontWeight: 500
                    }}
                  >
                    Add to my books
                  </button>
                </div>
                <div className="mt-2 flex space-x-2">
                  <button 
                    onClick={() => onFeedback(book.id, 'like')}
                    className="px-2 py-1 bg-green-500 text-white rounded"
                  >
                    Like
                  </button>
                  <button 
                    onClick={() => onFeedback(book.id, 'dislike')}
                    className="px-2 py-1 bg-red-500 text-white rounded"
                  >
                    Dislike
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------- Main App Component ---------------------------- */

function BookRecommendationApp() {
  // Initial static book database
  const [bookDatabase, setBookDatabase] = useState<any[]>([
    {
      id: 1,
      title: "The Great Gatsby",
      author: "F. Scott Fitzgerald",
      features: ["classic", "american literature", "tragedy", "wealth", "love", "1920s"],
      genre: "Literary Fiction",
      description: "A portrayal of the American Dream and its decay."
    },
    {
      id: 2,
      title: "To Kill a Mockingbird",
      author: "Harper Lee",
      features: ["classic", "american literature", "coming-of-age", "racism", "justice"],
      genre: "Literary Fiction",
      description: "A story of racial injustice and moral growth."
    },
    {
      id: 3,
      title: "1984",
      author: "George Orwell",
      features: ["dystopian", "political", "totalitarianism", "surveillance", "classic"],
      genre: "Science Fiction",
      description: "A dystopian vision of a totalitarian future."
    },
    {
      id: 4,
      title: "The Hobbit",
      author: "J.R.R. Tolkien",
      features: ["fantasy", "adventure", "quest", "dragons", "magic"],
      genre: "Fantasy",
      description: "A fantasy adventure preceding The Lord of the Rings."
    },
    {
      id: 5,
      title: "Harry Potter and the Sorcerer's Stone",
      author: "J.K. Rowling",
      features: ["fantasy", "magic", "coming-of-age", "boarding school", "friendship"],
      genre: "Fantasy",
      description: "The beginning of the magical journey of Harry Potter."
    },
    // … (other books remain unchanged)
  ]);

  // Recommendation state and feedback state (for user feedback loop)
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [recLoading, setRecLoading] = useState(false);
  const [feedbackMap, setFeedbackMap] = useState<Record<number, 'like' | 'dislike'>>({});
  const { userBooks, addBook, removeBook, error: booksError } = useUserBooks();
  const googleBooksHook = useGoogleBooks();

  // Add a book to the static database if it doesn't already exist.
  const addBookToDatabase = (book: any) => {
    setBookDatabase(prev => [...prev, book]);
  };

  // Recommendation engine
  const generateRecommendations = async () => {
    if (userBooks.length === 0) return;
    setRecLoading(true);
    try {
      const favoriteBooks = userBooks.filter(book => book.rating >= 4);
      const favoriteFeatures = _.flatten(favoriteBooks.map(book => book.features)).filter(Boolean);
      const featureCounts = _.countBy(favoriteFeatures);
      const genres = userBooks.map(book => book.genre).filter(Boolean);
      const genreCounts = _.countBy(genres);
      const topGenres = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0]);
      let additionalBooks: any[] = [];
      if (topGenres.length > 0 && topGenres[0] !== 'Unknown') {
        const genreQuery = encodeURIComponent(`subject:${topGenres[0]}`);
        try {
          const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${genreQuery}&maxResults=10`);
          if (response.ok) {
            const data = await response.json();
            if (data.items && data.items.length > 0) {
              additionalBooks = data.items.map((item: any) => {
                const volumeInfo = item.volumeInfo || {};
                const categories = volumeInfo.categories || [];
                return {
                  id: item.id,
                  title: volumeInfo.title || 'Unknown Title',
                  author: volumeInfo.authors ? volumeInfo.authors.join(', ') : 'Unknown Author',
                  genre: categories.length > 0 ? categories[0] : topGenres[0],
                  features: [...categories, volumeInfo.language || 'english'],
                  coverImage: volumeInfo.imageLinks ? volumeInfo.imageLinks.thumbnail : null,
                  description: volumeInfo.description || 'No synopsis available'
                };
              });
              additionalBooks.forEach(book => {
                const exists = bookDatabase.find(b => b.title === book.title);
                if (!exists) {
                  addBookToDatabase(book);
                }
              });
            }
          } else {
            console.error('Failed to fetch additional books');
          }
        } catch (err) {
          console.error('Error fetching additional books', err);
        }
      }
      const combinedDatabase = [...bookDatabase, ...additionalBooks];
      const recommendedBooks = combinedDatabase.filter(book => {
        const alreadyRead = userBooks.some(userBook => userBook.title.toLowerCase() === book.title.toLowerCase());
        if (alreadyRead) return false;
        let score = 0;
        if (book.features && book.features.length > 0) {
          book.features.forEach((feature: string) => {
            if (featureCounts[feature]) score += featureCounts[feature];
          });
        }
        if (topGenres.includes(book.genre)) {
          const genreIndex = topGenres.indexOf(book.genre);
          score += 5 - Math.min(genreIndex, 4);
        }
        // Adjust score based on user feedback.
        if (feedbackMap[book.id] === 'like') score += 3;
        if (feedbackMap[book.id] === 'dislike') score -= 5;
        book.score = score;
        return score > 0;
      }).sort((a, b) => b.score - a.score).slice(0, 5);
      setRecommendations(recommendedBooks);
    } catch (error) {
      console.error('Error generating recommendations:', error);
    } finally {
      setRecLoading(false);
    }
  };

  // Regenerate recommendations when userBooks or feedback changes.
  useEffect(() => {
    generateRecommendations();
  }, [userBooks, feedbackMap]);

  const handleFeedback = (bookId: number, type: 'like' | 'dislike') => {
    setFeedbackMap(prev => ({ ...prev, [bookId]: type }));
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-gray-50 rounded-lg shadow-lg">
      <h1 className="text-3xl font-bold text-center mb-8">Book Recommendation App</h1>
      {booksError && <p className="text-red-500">{booksError}</p>}
      <BookForm 
        onAddBook={addBook} 
        googleBooksHook={googleBooksHook} 
        bookDatabase={bookDatabase}
        addBookToDatabase={addBookToDatabase}
      />
      <StatsDashboard userBooks={userBooks} />
      <BookList userBooks={userBooks} onRemoveBook={removeBook} />
      <RecommendationList 
        recommendations={{ data: recommendations, loading: recLoading, userBooksEmpty: userBooks.length === 0 }}
        onAddBook={addBook}
        onFeedback={handleFeedback}
      />
    </div>
  );
}

export default BookRecommendationApp;
