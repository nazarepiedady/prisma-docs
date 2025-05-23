import React, { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DocSearchButton, useDocSearchKeyboardEvents } from "@docsearch/react";
import Head from "@docusaurus/Head";
import Link from "@docusaurus/Link";
import { useHistory } from "@docusaurus/router";
import { isRegexpStringMatch, useSearchLinkCreator } from "@docusaurus/theme-common";
import {
  useAlgoliaContextualFacetFilters,
  useSearchResultUrlProcessor,
} from "@docusaurus/theme-search-algolia/client";
import Translate from "@docusaurus/Translate";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import translations from "@theme/SearchTranslations";
import type {
  InternalDocSearchHit,
  DocSearchModal as DocSearchModalType,
  DocSearchModalProps,
  StoredDocSearchHit,
  DocSearchTransformClient,
  DocSearchHit,
} from "@docsearch/react";

import type { AutocompleteState } from "@algolia/autocomplete-core";
import type { FacetFilters } from "algoliasearch/lite";

// Constants
const MODAL_CLOSE_DELAY_MS = 100;
const DOM_CHECK_INTERVAL_MS = 100;

// Extend Window interface to include Kapa
declare global {
  interface Window {
    Kapa?: {
      open: (options: { query: string; submit: boolean }) => void;
    };
  }
}

type DocSearchProps = Omit<DocSearchModalProps, "onClose" | "initialScrollY"> & {
  contextualSearch?: string;
  externalUrlRegex?: string;
  searchPagePath: boolean | string;
};

// Add custom CSS for the Kapa AI button
const kapaStyles = `
.kapa-ai-button {
  display: flex;
  align-items: center;
  width: 100%;
  margin: 0 0 0 auto;
  width: fit-content;
  border: none;
  background: transparent;    font-size: 14px;
  color: var(--docsearch-highlight-color);
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
  border: transparent;
}

.kapa-ai-button > i {
  transition: transform 150ms ease-in-out;
}

.kapa-ai-button:hover > i:last-child {
  transform: translateX(4px);
}

.kapa-ai-text {
  font-weight: 700;
  display: flex;
  margin-right: 8px;
  align-items: center;
  text-decoration: underline;
  text-underline-offset: 4px;
  margin-left: 8px;
}

/* Override any external styles */
.DocSearch-KapaWrapper .kapa-ai-icon {
  flex-shrink: 0;
  width: 32px !important;
  height: 32px !important;
  max-width: 32px !important;
  max-height: 32px !important;
  object-fit: cover !important;
  object-position: 0 0 !important;
  display: inline-block !important;
  margin: 0 !important;
  padding: 0 !important;
}

/* Light mode logo */
[data-theme='light'] .kapa-ai-icon {
  content: url('https://www.prisma.io/docs/img/logo-dark.svg');
  width: 32px !important;
  height: 32px !important;
  max-width: 32px !important;
  max-height: 32px !important;
  object-fit: cover !important;
  object-position: 0 0 !important;
}

.DocSearch-KapaWrapper {
  padding: 0;
  margin: 12px 0 0 0;
  position: relative;
  order: -1;
  z-index: 10;
}

/* Make sure the Kapa wrapper appears at the top of the dropdown */
.DocSearch-Dropdown {
  display: flex;
  flex-direction: column;
}

.DocSearch-Dropdown-Container {
  order: 0;
}

.DocSearch-ResultsFooter {
  display: flex;
  flex-direction: column;
  padding: 0 1rem 1rem;
}
`;

let DocSearchModal: typeof DocSearchModalType | null = null;

function importDocSearchModalIfNeeded() {
  if (DocSearchModal) {
    return Promise.resolve();
  }
  return Promise.all([
    import("@docsearch/react/modal") as Promise<typeof import("@docsearch/react")>,
    import("@docsearch/react/style"),
    import("./styles.css"),
  ]).then(([{ DocSearchModal: Modal }]) => {
    DocSearchModal = Modal;
  });
}

function useNavigator({ externalUrlRegex }: Pick<DocSearchProps, "externalUrlRegex">) {
  const history = useHistory();
  const [navigator] = useState<DocSearchModalProps["navigator"]>(() => {
    return {
      navigate(params) {
        // Algolia results could contain URL's from other domains which cannot
        // be served through history and should navigate with window.location
        if (isRegexpStringMatch(externalUrlRegex, params.itemUrl)) {
          window.location.href = params.itemUrl;
        } else {
          history.push(params.itemUrl);
        }
      },
    };
  });
  return navigator;
}

function useTransformSearchClient(): DocSearchModalProps["transformSearchClient"] {
  const {
    siteMetadata: { docusaurusVersion },
  } = useDocusaurusContext();
  return useCallback(
    (searchClient: DocSearchTransformClient) => {
      searchClient.addAlgoliaAgent("docusaurus", docusaurusVersion);
      return searchClient;
    },
    [docusaurusVersion]
  );
}

function useTransformItems(props: Pick<DocSearchProps, "transformItems">) {
  const processSearchResultUrl = useSearchResultUrlProcessor();
  const [transformItems] = useState<DocSearchModalProps["transformItems"]>(() => {
    return (items: DocSearchHit[]) =>
      props.transformItems
        ? // Custom transformItems
          props.transformItems(items)
        : // Default transformItems
          items.map((item) => ({
            ...item,
            url: processSearchResultUrl(item.url),
          }));
  });
  return transformItems;
}

function Hit({
  hit,
  children,
}: {
  hit: InternalDocSearchHit | StoredDocSearchHit;
  children: React.ReactNode;
}) {
  return <Link to={hit.url}>{children}</Link>;
}

type ResultsFooterProps = {
  state: AutocompleteState<InternalDocSearchHit>;
  onClose: () => void;
};

function ResultsFooter({ state, onClose }: ResultsFooterProps) {
  const createSearchLink = useSearchLinkCreator();

  return (
    <div className="DocSearch-ResultsFooter">
      <Link to={createSearchLink(state.query)} onClick={onClose} className="DocSearch-SeeAllLink">
        <Translate id="theme.SearchBar.seeAll" values={{ count: state.context.nbHits }}>
          {"See all {count} results"}
        </Translate>
      </Link>
    </div>
  );
}

function useResultsFooterComponent({
  closeModal,
}: {
  closeModal: () => void;
}): DocSearchProps["resultsFooterComponent"] {
  return useMemo(
    () =>
      ({ state }) => <ResultsFooter state={state} onClose={closeModal} />,
    [closeModal]
  );
}

function useSearchParameters({
  contextualSearch,
  ...props
}: DocSearchProps): DocSearchProps["searchParameters"] {
  function mergeFacetFilters(f1: FacetFilters, f2: FacetFilters): FacetFilters {
    const normalize = (f: FacetFilters): FacetFilters => (typeof f === "string" ? [f] : f);
    return [...normalize(f1), ...normalize(f2)];
  }

  const contextualSearchFacetFilters = useAlgoliaContextualFacetFilters() as FacetFilters;

  const configFacetFilters: FacetFilters = props.searchParameters?.facetFilters ?? [];

  const facetFilters: FacetFilters = contextualSearch
    ? // Merge contextual search filters with config filters
      mergeFacetFilters(contextualSearchFacetFilters, configFacetFilters)
    : // ... or use config facetFilters
      configFacetFilters;

  // We let users override default searchParameters if they want to
  return {
    ...props.searchParameters,
    facetFilters,
  };
}

function DocSearch({ externalUrlRegex, ...props }: DocSearchProps) {
  const navigator = useNavigator({ externalUrlRegex });
  const searchParameters = useSearchParameters({ ...props });
  const transformItems = useTransformItems(props);
  const transformSearchClient = useTransformSearchClient();

  const searchContainer = useRef<HTMLDivElement | null>(null);
  // TODO remove "as any" after React 19 upgrade
  const searchButtonRef = useRef<HTMLButtonElement>(null as any);
  const [isOpen, setIsOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState<string | undefined>(undefined);

  // Define closeModal first to avoid reference issues
  const closeModal = useCallback(() => {
    setIsOpen(false);
    searchButtonRef.current?.focus();
    setInitialQuery(undefined);
  }, []);

  // Function to insert the Kapa button
  const insertKapaButton = useCallback(
    (query: string) => {
      if (!query) return;

      // Find the dropdown container
      const dropdown = document.querySelector(".DocSearch-Dropdown");
      if (!dropdown) return;

      // See if we already have a Kapa wrapper
      let kapaWrapper = document.querySelector(".DocSearch-KapaWrapper");

      // If not, create one
      if (!kapaWrapper) {
        kapaWrapper = document.createElement("div");
        kapaWrapper.className = "DocSearch-KapaWrapper";

        // Create a button element
        const button = document.createElement("button");
        button.className = "kapa-ai-button";
        button.setAttribute("type", "button");
        button.onclick = () => {
          // Grab the CURRENT query value from the input element right before closing
          const searchInput = document.querySelector(".DocSearch-Input");
          const currentQuery = searchInput instanceof HTMLInputElement ? searchInput.value : query;

          closeModal();
          setTimeout(() => {
            if (window.Kapa) {
              window.Kapa.open({ query: currentQuery, submit: true });
            }
          }, MODAL_CLOSE_DELAY_MS);
        };

        // Add the icon
        button.innerHTML = `
        <i class="fa-solid fa-robot"></i>
        <span class="kapa-ai-text">Ask AI about this topic</span>
        <i class="fa-solid fa-arrow-right"></i>
      `;

        kapaWrapper.appendChild(button);

        // Insert it at the top of the dropdown
        dropdown.insertBefore(kapaWrapper, dropdown.firstChild);
      } else {
        // Update the query text
        const textSpan = kapaWrapper.querySelector(".kapa-ai-text");
        if (textSpan) {
          textSpan.textContent = `Ask AI about this topic`;
        }
      }
    },
    [closeModal]
  );

  // Set up detection for when the search modal is ready and when query changes
  React.useEffect(() => {
    if (!isOpen) return;

    // Wait for the search modal to be fully rendered
    const checkForSearchBox = setInterval(() => {
      const searchBox = document.querySelector(".DocSearch-Form");
      const searchInput = document.querySelector(".DocSearch-Input");

      if (searchBox && searchInput instanceof HTMLInputElement) {
        clearInterval(checkForSearchBox);

        // If there's already text in the search input, use it
        if (searchInput.value) {
          insertKapaButton(searchInput.value);
        }

        // Listen for input events directly
        const handleInputChange = () => {
          if (searchInput.value) {
            insertKapaButton(searchInput.value);
          }
        };

        // Add input event listener for real-time updates
        searchInput.addEventListener("input", handleInputChange);

        // Clean up this listener when the modal closes or component unmounts
        return () => {
          searchInput.removeEventListener("input", handleInputChange);
        };
      }
    }, DOM_CHECK_INTERVAL_MS);

    // Clean up interval if component unmounts or modal closes
    return () => {
      clearInterval(checkForSearchBox);
    };
  }, [isOpen, insertKapaButton]);

  // Inject Kapa AI button styles
  React.useEffect(() => {
    const styleId = "kapa-ai-styles";

    // Only inject styles once
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement("style");
      styleEl.id = styleId;
      styleEl.textContent = kapaStyles;
      document.head.appendChild(styleEl);
    }

    return () => {
      // Clean up styles on unmount
      const styleEl = document.getElementById(styleId);
      if (styleEl) {
        styleEl.remove();
      }
    };
  }, []);

  const prepareSearchContainer = useCallback(() => {
    if (!searchContainer.current) {
      const divElement = document.createElement("div");
      searchContainer.current = divElement;
      document.body.insertBefore(divElement, document.body.firstChild);
    }
  }, []);

  const openModal = useCallback(() => {
    prepareSearchContainer();
    importDocSearchModalIfNeeded().then(() => setIsOpen(true));
  }, [prepareSearchContainer]);

  const handleInput = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "f" && (event.metaKey || event.ctrlKey)) {
        // ignore browser's ctrl+f
        return;
      }
      // prevents duplicate key insertion in the modal input
      event.preventDefault();
      setInitialQuery(event.key);
      openModal();
    },
    [openModal]
  );

  const resultsFooterComponent = useResultsFooterComponent({ closeModal });

  useDocSearchKeyboardEvents({
    isOpen,
    onOpen: openModal,
    onClose: closeModal,
    onInput: handleInput,
    searchButtonRef,
  });

  return (
    <>
      <Head>
        {/* This hints the browser that the website will load data from Algolia,
        and allows it to preconnect to the DocSearch cluster. It makes the first
        query faster, especially on mobile. */}
        <link
          rel="preconnect"
          href={`https://${props.appId}-dsn.algolia.net`}
          crossOrigin="anonymous"
        />
      </Head>

      <DocSearchButton
        onTouchStart={importDocSearchModalIfNeeded}
        onFocus={importDocSearchModalIfNeeded}
        onMouseOver={importDocSearchModalIfNeeded}
        onClick={openModal}
        ref={searchButtonRef}
        translations={props.translations?.button ?? translations.button}
      />

      {isOpen &&
        DocSearchModal &&
        searchContainer.current &&
        createPortal(
          <DocSearchModal
            onClose={closeModal}
            initialScrollY={window.scrollY}
            initialQuery={initialQuery}
            navigator={navigator}
            transformItems={transformItems}
            hitComponent={Hit}
            transformSearchClient={transformSearchClient}
            {...(props.searchPagePath && {
              resultsFooterComponent,
            })}
            placeholder={translations.placeholder}
            {...props}
            translations={props.translations?.modal ?? translations.modal}
            searchParameters={searchParameters}
          />,
          searchContainer.current
        )}
    </>
  );
}

export default function SearchBar(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return <DocSearch {...(siteConfig.themeConfig.algolia as DocSearchProps)} />;
}
