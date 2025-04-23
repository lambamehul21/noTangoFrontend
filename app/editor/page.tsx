"use client"
import { useRef, useEffect, useState } from 'react'
import grapesjs from 'grapesjs'
import "grapesjs/dist/css/grapes.min.css"
import "./styles.css" // Import the separated CSS file
import axios from 'axios'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faSave,
  faFileExport,
  faLayerGroup,
  faPencilAlt,
  faDatabase,
  faTextWidth,
  faHeading,
  faImage,
  faSquare,
  faArrowUp,
  faWindowMaximize,
  faTrash,
  faPlus,
  faDownload
} from '@fortawesome/free-solid-svg-icons'
// Import jsPDF and html2canvas (you'll need to install these)
// npm install jspdf html2canvas
// Also import the file icon from regular set
// npm install @fortawesome/free-regular-svg-icons
import { faFileAlt } from '@fortawesome/free-regular-svg-icons'
// You'll need to dynamically import jsPDF and html2canvas in useEffect due to SSR

// Extend the Editor type to include our custom property
declare module 'grapesjs' {
  interface Editor {
    isMainEditor?: boolean;
  }
}

interface XmlRecord {
  id: string,
  path: string,
  value: string
}

interface TreeNode {
  key: string,
  label: string,
  path: string,
  value: string | null,
  children: TreeNode[],
  isLeaf: boolean,
  isExpanded?: boolean
}

interface EditorInstance {
  id: string;
  editor: any;
  containerEl: HTMLElement;
  parentFrameId?: string;
  autoSaveInterval?: NodeJS.Timeout;
  frameDimensions?: {
    width: string;
    height: string;
    padding: string;
    autoHeight: boolean;
  };
}

const EditorGrapes = () => {
  const editorRef = useRef<any>(null);
  const [activeTab, setActiveTab] = useState('properties');
  const selectedComponentRef = useRef<any>(null);
  const styleManagerRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);
  const [xmlCode, setXmlCode] = useState<string>('');
  const [showXmlExport, setShowXmlExport] = useState<boolean>(false);
  const [tableNames, setTableNames] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [isLoadingTables, setIsLoadingTables] = useState<boolean>(false);
  const [records, setRecords] = useState<XmlRecord[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState<boolean>(false);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [pages, setPages] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState<any>(null);
  
  // New state for PDF preview 
  const [showPdfPreview, setShowPdfPreview] = useState<boolean>(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  
  // New state for nested editing
  const [editorInstances, setEditorInstances] = useState<EditorInstance[]>([]);
  const [activeEditorIndex, setActiveEditorIndex] = useState<number>(0);
  const [showNestedEditor, setShowNestedEditor] = useState<boolean>(false);
  const [editorBreadcrumbs, setEditorBreadcrumbs] = useState<string[]>(['Main Editor']);
  const nestedEditorContainerRef = useRef<HTMLDivElement>(null);

  const buildTree = (records: XmlRecord[]): TreeNode[] => {
    const root: TreeNode = {
      key: 'root',
      label: 'root',
      path: '',
      value: null,
      children: [],
      isLeaf: false,
      isExpanded: false
    }
    const nodeMap: Record<string, TreeNode> = { '': root };
    const sortedRecords = [...records].sort((a, b) => a.path.localeCompare(b.path));

    sortedRecords.forEach(record => {
      const pathSegments = record.path.split('/');
      let currentPath = '';
      let parentPath = '';
      for (let i = 1; i < pathSegments.length; i++) {
        const segment = pathSegments[i];
        if (!segment) continue;
        parentPath = currentPath;
        currentPath += '/' + segment;
        if (!nodeMap[currentPath]) {
          const label = segment.replace(/\[\d+\]$/, '');
          const newNode: TreeNode = {
            key: currentPath,
            label: label,
            path: currentPath,
            value: null,
            children: [],
            isLeaf: i == pathSegments.length - 1
          }
          nodeMap[currentPath] = newNode;
          nodeMap[parentPath].children.push(newNode);
        }
        if (i === pathSegments.length - 1) {
          nodeMap[currentPath].value = record.value;
        }
      }
    });
    return root.children;
  }

  useEffect(() => {
    if (!selectedTable) return;
    const fetchRecords = async () => {
      setIsLoadingRecords(true);
      try {
        const response = await axios.get(`http://localhost:8080/xml/records?tableName=${selectedTable}`);
        setRecords(response.data);
        // Build the tree from the flat records
        const tree = buildTree(response.data);
        setTreeData(tree);

        // Expand the first level by default
        const newExpandedKeys = new Set<string>();
        tree.forEach(node => {
          newExpandedKeys.add(node.key);
        });
        setExpandedKeys(newExpandedKeys);
      } catch (error) {
        console.log("Error fetching records", error)
      } finally {
        setIsLoadingRecords(false);
      }
    };
    fetchRecords();
  }, [selectedTable]);

  useEffect(() => {
    const fetchTableNames = async () => {
      setIsLoadingTables(true)
      try {
        const response = await axios.get(`http://localhost:8080/xml/tables`);
        setTableNames(response.data)
        if (response.data.length > 0) {
          setSelectedTable(response.data[0]);
        }
      } catch (error) {
        console.log("error fetching table names", error);
      } finally {
        setIsLoadingTables(false)
      }
    };

    fetchTableNames();
  }, []);

  // Helper function to initialize a GrapesJS editor
  const initializeEditor = (
    containerId: string, 
    content: string = '', 
    parentFrameId?: string
  ): any => {
    // Create common editor config with shared blocks, style sectors, etc.
    const editorConfig = {
      container: `#${containerId}`,
      height: "100%",
      width: "100%",
      fromElement: false,
      storageManager: { autoload: false },
      
      dragMode: 'absolute' as const,
      deviceManager: { devices: [] },
      
      canvas: {
        styles: [],
        scripts: [],
      },
      
      blockManager: {
        appendTo: `#blocks-${containerId}`,
        blocks: [
          {
            id: 'text',
            label: 'Text Box',
            category: 'Basic',
            content: {
              type: 'text',
              content: 'Insert your text here',
              style: { padding: '10px', minHeight: '50px' }
            },
            media: '<i class="fa fa-text-width"></i>'
          },
          {
            id: 'heading',
            label: 'Heading',
            category: 'Basic',
            content: {
              type: 'text',
              content: '<h1>Heading</h1>',
              style: { padding: '10px', minHeight: '50px' }
            },
            media: '<i class="fa fa-header"></i>'
          },
          {
            id: 'image',
            label: 'Image',
            category: 'Basic',
            select: true,
            content: { type: 'image' },
            media: '<i class="fa fa-image"></i>'
          },
          {
            id: 'frame',
            label: 'Frame',
            category: 'Structure',
            content: {
              type: 'frame',
              style: { 
                padding: '20px',
                minHeight: '100px',
                backgroundColor: '#e8f4fc',
                border: '1px dashed #3498db'
              }
            },
            media: '<i class="fa fa-window-maximize"></i>'
          }
        ]
      },
      
      // Configure panels with export button
      panels: {
        defaults: [
          {
            id: 'panel-top',
            el: `.panel-top-${containerId}`,
            buttons: [
              {
                id: 'save',
                className: 'btn-save',
                label: 'Save',
                command: 'save-page',
              },
              {
                id: 'export-xml',
                className: 'btn-export-xml',
                label: 'Export XML',
                command: 'export-xml',
              }
            ],
          }
        ]
      },
      
      // Enable style manager
      styleManager: {
        appendTo: `#style-manager-${containerId}`,
        sectors: [
          {
            name: 'Typography',
            open: false,
            buildProps: ['font-family', 'font-size', 'font-weight', 'letter-spacing', 'color', 'text-align', 'text-shadow', 'line-height']
          },
          {
            name: 'Dimension',
            open: false,
            buildProps: ['width', 'height', 'max-width', 'min-height', 'margin', 'padding']
          },
          {
            name: 'Decorations',
            open: false,
            buildProps: ['background-color', 'border', 'border-radius', 'box-shadow']
          },
          {
            name: 'Position',
            open: false,
            buildProps: ['position', 'top', 'left', 'bottom', 'right']
          }
        ]
      },

      // Enable layer manager
      layerManager: {
        appendTo: `#layers-container-${containerId}`
      },
      
      // Use plugins
      plugins: [],
      
      // Start with the provided content or empty
      components: content,
    };
    
    // Initialize the editor
    const editor = grapesjs.init(editorConfig);

    // Add a flag to identify the main editor instance
    editor.isMainEditor = (containerId === 'main-editor');

    // Add the save command
    editor.Commands.add("save-page", {
      run(editor) {
        const html = editor.getHtml();
        const css = editor.getCss();
        console.log("HTML Output:", html);
        console.log("CSS Output:", css);
        alert("Page saved! Check the console for HTML and CSS output.");
      },
    });

    // Add the export XML command
    editor.Commands.add("export-xml", {
      run(editor) {
        const componentsJSON = editor.getComponents();
        const xmlOutput = convertToXML(componentsJSON);
        setXmlCode(xmlOutput);
        setShowXmlExport(true);
      },
    });

    // Add a command to handle dropped XML record values
    editor.Commands.add('handle-record-drop', {
      run(editor, sender, options) {
        const { recordData, dropPosition } = options;
        if (!recordData || !dropPosition) return;

        // Parse the record data if it's a string
        let value = recordData.value;
        if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value);
            if (parsed.type === 'record') {
              value = parsed.value;
            }
          } catch (e) {
            // If parsing fails, use the original value
            console.log('Not a JSON string, using original value');
          }
        }

        // Create a textbox component with ONLY the record value as content
        const component = editor.DomComponents.addComponent({
          type: 'text',
          content: value,
          style: { 
            position: 'absolute',
            left: `${dropPosition.x}px`,
            top: `${dropPosition.y}px`,
            padding: '10px',
            minHeight: '30px',
            minWidth: '100px',
            backgroundColor: '#f8f9fa',
            //border: '1px solid #cce0ff',
            borderRadius: '4px',
          },
          attributes: {
            'data-record-path': recordData.path,
            'data-record-value': value,
          }
        });

        // Select the new component
        editor.select(component);
      }
    });

    // Set up the editor to handle dropped records
    const setupRecordDropHandling = () => {
      // Get the canvas frame element
      const frameEl = editor.Canvas.getFrameEl();
      if (!frameEl || !frameEl.contentDocument) return;

      const canvasBody = frameEl.contentDocument.body;
      
      // Add drop event listeners to the canvas
      canvasBody.addEventListener('dragover', (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'copy';
        }
      });

      canvasBody.addEventListener('drop', (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        try {
          if (!e.dataTransfer) return;
          
          const data = e.dataTransfer.getData('text/plain');
          if (!data) return;
          
          const recordData = JSON.parse(data);
          if (recordData.type !== 'record') return;
          
          // Get drop position relative to the canvas
          const canvasRect = canvasBody.getBoundingClientRect();
          const dropPosition = {
            x: e.clientX - canvasRect.left,
            y: e.clientY - canvasRect.top
          };
          
          // Run the drop handler command
          editor.runCommand('handle-record-drop', { 
            recordData, 
            dropPosition 
          });
        } catch (error) {
          console.error('Error handling record drop:', error);
        }
      });
    };

    // Initialize drop handling after editor is ready
    editor.on('load', () => {
      setupRecordDropHandling();
    });

    // Re-initialize drop handling if the canvas is reloaded
    editor.on('canvas:load', () => {
      setupRecordDropHandling();
    });

    // Override the text component to make it fully resizable and draggable
    editor.DomComponents.addType('text', {
      model: {
        defaults: {
          draggable: true,
          droppable: true,
          resizable: {
            tl: true, tr: true, bl: true, br: true,
            tc: true, bc: true, cl: true, cr: true
          },
          style: {
            position: 'relative',
            padding: '10px',
            minHeight: '50px',
            minWidth: '50px'
          }
        }
      }
    });

    // Define the improved and error-proof frame component
    editor.DomComponents.addType('frame', {
      model: {
        defaults: {
          name: 'Frame',
          droppable: true,
          draggable: true,
          resizable: {
            tl: true, tr: true, bl: true, br: true,
            tc: true, bc: true, cl: true, cr: true
          },
          style: {
            position: 'relative',
            padding: '20px',
            minHeight: '100px',
            minWidth: '100px',
            backgroundColor: '#e8f4fc',
            border: '1px dashed #3498db',
            borderRadius: '4px',
          },
          // Store a unique ID for the frame
          attributes: { 
            'data-frame-id': Date.now().toString(),
            'data-auto-height': 'true',
          },
          // Indicator for frames that can be drilled into
          icon: '<i class="fa fa-window-maximize"></i>',
          label: 'Frame',
          // Custom toolbar for frame components
          toolbar: [
            { 
              attributes: { class: 'fa fa-pencil' },
              command: 'frame-edit', // Custom command for drilling down
            },
            { 
              attributes: { class: 'fa fa-arrows' },
              command: 'tlb-move', 
            },
            { 
              attributes: { class: 'fa fa-clone' },
              command: 'tlb-clone', 
            },
            { 
              attributes: { class: 'fa fa-trash-o' },
              command: 'tlb-delete', 
            },
            // Add toggle for auto-height
            {
              attributes: { class: 'fa fa-arrows-v', title: 'Toggle auto-height' },
              command: {
                run: function(editor: any, sender: any, options: any) {
                  const component = editor.getSelected();
                  const autoHeight = component.getAttributes()['data-auto-height'] === 'true';
                  component.setAttributes({ 'data-auto-height': (!autoHeight).toString() });
                  return component;
                }
              },
            },
          ],
        }
      },
      view: {
        events: {
          'dblclick': 'onDblClick',
          // Add mousedown listener to intercept clicks on content
          'mousedown': 'handleContentInteraction'
        } as any,
        onDblClick(e: MouseEvent) {
          e.preventDefault();
          e.stopPropagation();
          const model = this.model;
          
          // Get the editor instance from the view
          const editor = this.em as any;
          if (editor && typeof editor.Commands.run === 'function') {
            editor.Commands.run('frame-edit', { frameComponent: model });
          } else {
            console.error('Could not find editor instance for double-click handling');
          }
        },
        init() {
          const model = this.model;
          this.listenTo(model, 'change:style', this.updateStatus);
        },
        updateStatus() {
          // Update UI to show this is a drillable component
          // This can be expanded with custom styling
        },
        handleContentInteraction(e: MouseEvent) {
          const model = this.model;
          const editor = this.em as any; // Get the editor instance (em stands for Editor Model)

          // Check if we are in the main editor context using the flag
          if (editor.isMainEditor) {
            const target = e.target as HTMLElement;
            const frameEl = this.el;

            // Check if the target is actually inside the frame's content area
            // and not the frame itself
            if (target !== frameEl && frameEl.contains(target)) {
              // Prevent GrapesJS from selecting the inner element
              console.log('Intercepting click inside frame content in parent editor.');
              e.stopPropagation(); 
              e.preventDefault();

              // Always select the frame itself when clicking inside its content area
              editor.select(model);
              
              // Return false to prevent any additional event handling
              return false;
            }
          }
          // If not in the main editor, or clicking the frame itself, allow normal behavior
        },
      }
    });

    // Add a more robust command for editing frames
    editor.Commands.add('frame-edit', {
      run(editor, sender, options = {}) {
        const frameComponent = options.frameComponent;
        if (frameComponent) {
          try {
            // Get the frame ID, generating a new one if it doesn't exist
            let frameId = frameComponent.getAttributes()['data-frame-id'];
            if (!frameId) {
              frameId = `frame-${Date.now()}`;
              frameComponent.setAttributes({ 'data-frame-id': frameId });
            }
            
            // Get the frame dimensions
            const frameEl = frameComponent.view.el;
            const frameRect = frameEl.getBoundingClientRect();
            const frameWidth = frameComponent.getStyle().width || `${frameRect.width}px`;
            const frameHeight = frameComponent.getStyle().height || `${frameRect.height}px`;
            const framePadding = frameComponent.getStyle().padding || '20px';
            const autoHeight = frameComponent.getAttributes()['data-auto-height'] === 'true';
            
            // Get the frame's HTML content
            let frameContent = '';
            
            // Try different methods to get the content
            try {
              // Method 1: Get HTML directly from the component
              frameContent = editor.getHtml(frameComponent);
            } catch (err) {
              console.warn('Method 1 failed to get frame content:', err);
              
              try {
                // Method 2: Build HTML from components
                frameComponent.components().forEach((comp: any) => {
                  frameContent += comp.toHTML();
                });
              } catch (err) {
                console.warn('Method 2 failed to get frame content:', err);
                
                try {
                  // Method 3: Get from DOM element if available
                  const el = frameComponent.view && frameComponent.view.el;
                  if (el) {
                    frameContent = el.innerHTML;
                  }
                } catch (err) {
                  console.warn('Method 3 failed to get frame content:', err);
                }
              }
            }
            
            // If we still don't have content, use a placeholder
            if (!frameContent || frameContent.trim() === '') {
              frameContent = '<div style="min-height: 50px;"></div>';
            }
            
            // Create a new editor for this frame's content
            createNestedEditor(
              frameId, 
              frameContent, 
              {
                width: frameWidth,
                height: frameHeight,
                padding: framePadding,
                autoHeight
              }
            );
          } catch (error) {
            console.error('Error opening frame editor:', error);
            alert('There was an error opening the frame editor. Please try again.');
          }
        } else {
          console.error('No frame component provided to frame-edit command');
        }
      }
    });

    // Set default resizable options for all components
    editor.on('component:create', component => {
      if (!component.get('resizable')) {
        component.set({
          draggable: true,
          droppable: true,
          resizable: {
            tl: true, tr: true, bl: true, br: true,
            tc: true, bc: true, cl: true, cr: true
          }
        });
      }
    });

    // Track selected component
    editor.on('component:selected', (component) => {
      selectedComponentRef.current = component;
    });
    
    // Clear selected component reference when deselected
    editor.on('component:deselected', () => {
      selectedComponentRef.current = null;
    });

    return editor;
  };

  // Enhanced and fixed returnToParentEditor function with robust error handling
  const returnToParentEditor = () => {
    if (activeEditorIndex <= 0) {
      // Already at the root editor, nothing to do
      return;
    }
    
    try {
      // Get the current and parent editor instances
      const currentEditorInstance = editorInstances[activeEditorIndex];
      const parentEditorIndex = activeEditorIndex - 1;
      const parentEditorInstance = editorInstances[parentEditorIndex];
      
      if (currentEditorInstance && parentEditorInstance) {
        // Get the current editor content
        const currentEditor = currentEditorInstance.editor;
        const frameId = currentEditorInstance.parentFrameId;
        const frameDimensions = currentEditorInstance.frameDimensions;
        
        if (!frameId) {
          console.error("Missing parent frame ID");
          throw new Error("Missing parent frame ID");
        }
        
        // Get the parent editor instance
        const parentEditor = parentEditorInstance.editor;
        
        // Find the corresponding frame component in the parent editor
        let parentFrame: any = null;
        
        // Recursive function to find the frame with matching ID
        const findFrameById = (components: any): any => {
          let found: any = null;
          components.forEach((component: any) => {
            if (found) return;
            
            const attrs = component.getAttributes();
            if (component.get('type') === 'frame' && attrs && attrs['data-frame-id'] === frameId) {
              found = component;
              return;
            }
            
            if (component.components && component.components().length) {
              const nestedFound = findFrameById(component.components());
              if (nestedFound) found = nestedFound;
            }
          });
          return found;
        };
        
        // Start search from top-level components
        parentFrame = findFrameById(parentEditor.getComponents());
        
        if (parentFrame) {
          // Store the frame's important properties
          const originalStyle = { ...parentFrame.getStyle() };
          const originalAttributes = { ...parentFrame.getAttributes() };
          const autoHeight = originalAttributes['data-auto-height'] === 'true';
          
          try {
            // Get the frame content as a JSON component structure (preserves GrapesJS component types)
            const frameComponents = currentEditor.getComponents();
            const frameJson = JSON.stringify(frameComponents.toJSON());
            console.log('Frame JSON content structure:', frameJson);
            
            // Get CSS from the current editor
            const frameCss = currentEditor.getCss();
            console.log('Frame CSS content:', frameCss);
            
            // First, preserve the original frame dimensions before any modifications
            if (frameDimensions) {
              preserveFrameDimensions(frameId, frameDimensions);
            }
            
            // Get the stored original dimensions
            let originalDimensions = null;
            try {
              const storedDimensions = sessionStorage.getItem(`frame-original-dimensions-${frameId}`);
              if (storedDimensions) {
                originalDimensions = JSON.parse(storedDimensions);
                console.log('Using original dimensions when returning to parent:', originalDimensions);
                
                // Apply these dimensions to the original style
                if (originalDimensions) {
                  originalStyle.width = originalDimensions.width;
                  originalStyle.height = originalDimensions.height;
                  originalStyle.padding = originalDimensions.padding;
                }
              }
            } catch (err) {
              console.warn('Unable to retrieve original dimensions when returning to parent:', err);
            }
            
            // First, clear existing components within the frame
            parentFrame.components().reset();
            
            // IMPROVED COMPONENT TRANSFER: Use a more reliable method to transfer components
            try {
              const componentsJson = JSON.parse(frameJson);
              
              // Use a two-step process:
              // 1. First set the inner content to HTML to ensure proper rendering
              const tempHtml = currentEditor.getHtml();
              console.log('Using HTML content as backup:', tempHtml);
              
              // 2. Then use the proper component structure for maintaining types
              if (Array.isArray(componentsJson) && componentsJson.length > 0) {
                // This is the key fix - use components() to add the full structure at once
                // rather than appending individual components
                parentFrame.components().add(componentsJson);
                
                // Force render update
                parentEditor.render();
                
                console.log('Added components from JSON structure');
              } else if (tempHtml && tempHtml.trim() !== '') {
                // Fallback to HTML if JSON structure is empty but HTML exists
                parentFrame.set('content', tempHtml);
                console.log('Used HTML content as fallback');
              } else {
                // If no components or valid HTML, add an empty placeholder
                parentFrame.append({
                  type: 'default',
                  content: '',
                  style: { minHeight: '50px' }
                });
                console.log('Added empty placeholder');
              }
              
              // Force component refresh
              parentFrame.view.render();
              
              // Add debugging to check resulting components
              console.log('Resulting parent frame components:', 
                parentFrame.components().length, 
                parentFrame.components().models);
            } catch (jsonError) {
              console.error("Error transferring components:", jsonError);
              
              // More robust fallback using HTML content directly
              try {
                const htmlContent = currentEditor.getHtml();
                if (htmlContent && htmlContent.trim() !== '') {
                  parentFrame.set('content', htmlContent);
                  console.log('Used direct HTML content after JSON error');
                } else {
                  // Final fallback if all else fails
                  parentFrame.append({
                    type: 'default',
                    content: '',
                    style: { minHeight: '50px' }
                  });
                }
              } catch (htmlError) {
                console.error("Error using HTML fallback:", htmlError);
                parentFrame.append({
                  type: 'default',
                  content: '',
                  style: { minHeight: '50px' }
                });
              }
            }
            
            // Handle auto-resize of frame based on content height if auto-height is enabled
            if (autoHeight && frameDimensions) {
              try {
                // Get the height from the frame dimensions display
                const frameHeightEl = document.querySelector('.frame-height');
                if (frameHeightEl && frameHeightEl.textContent) {
                  const contentHeight = frameHeightEl.textContent;
                  if (contentHeight && contentHeight !== 'auto') {
                    // Get current height to compare
                    const currentHeight = originalStyle.height || '';
                    const currentHeightValue = parseInt(currentHeight) || 0;
                    const newHeightValue = parseInt(contentHeight) || 0;
                    
                    // Only grow, never shrink - only apply if larger than current
                    if (!currentHeight || currentHeightValue < newHeightValue) {
                      console.log(`Frame growing from ${currentHeight} to ${contentHeight}`);
                      
                      // Update the frame height
                      originalStyle.height = contentHeight;
                      
                      // Also update the stored dimensions
                      const updatedDimensions = {
                        width: originalStyle.width,
                        height: contentHeight,
                        padding: originalStyle.padding,
                        autoHeight: true
                      };
                      
                      preserveFrameDimensions(frameId, updatedDimensions);
                      console.log(`Auto-resizing frame to height: ${contentHeight}`);
                    } else {
                      console.log(`Skipping auto-height update in parent: current=${currentHeight}, new=${contentHeight}`);
                    }
                  }
                }
              } catch (resizeError) {
                console.error('Error auto-resizing frame:', resizeError);
              }
            }
            
            // Clean up any resize observers
            try {
              const framePreviewWrapper = document.querySelector('.frame-preview-wrapper');
              if (framePreviewWrapper && (framePreviewWrapper as any).cleanup) {
                (framePreviewWrapper as any).cleanup();
              }
            } catch (cleanupError) {
              console.warn('Error cleaning up frame observers:', cleanupError);
            }
            
            // Apply the CSS from the nested editor to the parent
            if (frameCss && frameCss.trim()) {
              try {
                // Get existing rules to avoid duplicates
                const existingCss = parentEditor.getCss();
                const existingRules = new Set(existingCss.split('\n').map((line: string) => line.trim()));
                
                // Filter out rules that already exist in the parent
                const newCssRules = frameCss.split('\n')
                  .filter((line: string) => !existingRules.has(line.trim()))
                  .join('\n');
                
                if (newCssRules.trim()) {
                  // Add only new CSS rules to the parent editor
                  parentEditor.addStyle(newCssRules);
                }
              } catch (cssError) {
                console.error('Error applying CSS to parent editor:', cssError);
              }
            }
            
            // Make sure the frame keeps its original styles and attributes
            parentFrame.setStyle(originalStyle);
            parentFrame.setAttributes(originalAttributes);
            
            // Select the frame in the parent editor
            parentEditor.select(parentFrame);
            
            // Force parent editor to re-render
            parentEditor.refresh();
          } catch (error) {
            console.error("Detailed error updating frame content:", error);
            alert("There was an error updating the frame content. The frame may be empty or contain invalid content. Check the console for details.");
            
            // Restore empty frame with original properties as a fallback
            parentFrame.components().reset();
            parentFrame.setStyle(originalStyle);
            parentFrame.setAttributes(originalAttributes);
          }
        } else {
          console.error("Could not find parent frame component");
          alert("Could not find the parent frame. Changes may not be saved.");
        }
        
        // Clean up the auto-save interval if it exists
        if (currentEditorInstance.autoSaveInterval) {
          clearInterval(currentEditorInstance.autoSaveInterval);
        }
      }
    } catch (error) {
      console.error("Error returning to parent editor:", error);
      alert("There was an error returning to the parent editor. Please try again.");
    }
    
    // Update the active editor index
    setActiveEditorIndex(activeEditorIndex - 1);
    
    // Update breadcrumbs
    setEditorBreadcrumbs(prev => prev.slice(0, -1));
    
    // If we're back at the main editor, hide the nested editor
    if (activeEditorIndex - 1 === 0) {
      setShowNestedEditor(false);
    }
  };

  // Add this improved function to ensure components are properly saved and sync between editors
  const saveFrameContent = (editor: any, frameId: string, frameDimensions?: any) => {
    try {
      // Get component structure as JSON to preserve component types
      const componentsJson = editor.getComponents().toJSON();
      const contentJson = JSON.stringify(componentsJson);
      sessionStorage.setItem(`frame-content-${frameId}-json`, contentJson);
      
      // Also save HTML as fallback - this is essential for proper content recovery
      const html = editor.getHtml();
      sessionStorage.setItem(`frame-content-${frameId}-html`, html);
      
      // Save CSS
      const css = editor.getCss();
      if (css) {
        sessionStorage.setItem(`frame-content-${frameId}-css`, css);
      }
      
      // Save component count for debugging
      const componentCount = editor.getComponents().length;
      sessionStorage.setItem(`frame-content-${frameId}-component-count`, componentCount.toString());
      
      // Save raw HTML of the canvas for further backup
      try {
        const canvasHtml = editor.Canvas.getDocument().body.innerHTML;
        sessionStorage.setItem(`frame-content-${frameId}-canvas-html`, canvasHtml);
      } catch (canvasErr) {
        console.warn('Could not save canvas HTML:', canvasErr);
      }
      
      // Save current component selection state if available
      try {
        const selectedComponent = editor.getSelected();
        if (selectedComponent) {
          const componentId = selectedComponent.getId();
          if (componentId) {
            sessionStorage.setItem(`frame-content-${frameId}-selected`, componentId);
          }
        }
      } catch (selectionErr) {
        console.warn('Could not save selection state:', selectionErr);
      }
      
      // Save dimensions if auto-height is enabled
      if (frameDimensions?.autoHeight) {
        try {
          // Get the canvas document and body
          const canvas = editor.Canvas.getDocument();
          if (canvas && canvas.body) {
            // Get the actual height of the content
            const contentHeight = canvas.body.scrollHeight;
            sessionStorage.setItem(`frame-content-${frameId}-height`, contentHeight + 'px');
          }
        } catch (err) {
          console.warn('Error saving frame dimensions:', err);
        }
      }
      
      console.log(`Frame content for ${frameId} saved successfully (${componentCount} components)`);
      return true;
    } catch (err) {
      console.error('Error saving frame content:', err);
      return false;
    }
  };

  // Create a new nested editor for a frame with consistent sidebars
  const createNestedEditor = (
    frameId: string, 
    frameContent: string,
    frameDimensions?: {
      width: string;
      height: string;
      padding: string;
      autoHeight: boolean;
    }
  ) => {
    // Generate a unique ID for this nested editor
    const nestedEditorId = `nested-editor-${Date.now()}`;
    
    // Store the original dimensions immediately to prevent loss
    if (frameDimensions) {
      preserveFrameDimensions(frameId, frameDimensions);
    }
    
    // Check for previously stored original dimensions
    // This takes precedence over auto-height calculations
    let originalDimensions = null;
    try {
      const storedDimensions = sessionStorage.getItem(`frame-original-dimensions-${frameId}`);
      if (storedDimensions) {
        originalDimensions = JSON.parse(storedDimensions);
        console.log('Retrieved original dimensions for frame:', frameId, originalDimensions);
      }
    } catch (err) {
      console.warn('Unable to retrieve original dimensions:', err);
    }
    
    // Use original dimensions if available, otherwise use the provided dimensions
    const dimensionsToUse = originalDimensions || frameDimensions;
    
    // Clean up any previous content
    if (nestedEditorContainerRef.current) {
      nestedEditorContainerRef.current.innerHTML = '';
      
      // Create a complete editor structure with sidebars similar to the main editor
      // Now including all the same tabs as the main editor
      nestedEditorContainerRef.current.innerHTML = `
        <div class="editor-main nested-editor-structure">
          <!-- Left sidebar - Block manager -->
          <div class="panel-left">
            <div class="panel-header">
              <i class="fa fa-square"></i> Blocks
            </div>
            <div id="blocks-${nestedEditorId}" class="panel-blocks"></div>
          </div>

          <!-- Main editor canvas with frame preview container -->
          <div class="editor-canvas-container">
            <!-- Frame dimensions display -->
            <div class="frame-dimensions-display">
              <span class="dimension-label">Frame: </span>
              <span class="frame-width">${dimensionsToUse?.width || 'auto'}</span> × 
              <span class="frame-height">${dimensionsToUse?.height || 'auto'}</span>
              <span class="auto-height-indicator ${dimensionsToUse?.autoHeight ? 'active' : ''}">
                Auto-height ${dimensionsToUse?.autoHeight ? 'ON' : 'OFF'}
              </span>
            </div>
            
            <!-- Frame preview wrapper that constrains the canvas -->
            <div class="frame-preview-wrapper" 
                 style="${dimensionsToUse ? `
                   width: ${dimensionsToUse.width}; 
                   min-height: ${dimensionsToUse.height};
                   padding: ${dimensionsToUse.padding};
                   ${dimensionsToUse.autoHeight ? 'height: auto;' : `height: ${dimensionsToUse.height};`}
                 ` : ''}">
              <div id="${nestedEditorId}" class="editor-canvas frame-preview-canvas"></div>
            </div>
          </div>

          <!-- Right sidebar with tabs -->
          <div class="panel-right">
            <div class="panel-tabs">
              <button class="tab-btn active" data-tab="properties">
                <i class="fa fa-pencil-alt"></i> Properties
              </button>
              <button class="tab-btn" data-tab="objects">
                <i class="fa fa-layer-group"></i> Objects
              </button>
              <button class="tab-btn" data-tab="records">
                <i class="fa fa-database"></i> Records
              </button>
            </div>
            <div class="panel-content">
              <div id="style-manager-${nestedEditorId}" class="style-manager-container" style="display: block;"></div>
              <div id="layers-container-${nestedEditorId}" class="layers-container" style="display: none;"></div>
              <div 
                id="records-${nestedEditorId}" 
                style="display: none;"
                class="records-container"
              >
                <div class="records-header">
                  <h3><i class="fa fa-database"></i> XML Records</h3>
                  <div class="table-selector">
                    <label for="table-select-${nestedEditorId}">Select XML Table:</label>
                    <select 
                      id="table-select-${nestedEditorId}" 
                      class="nested-table-select"
                    >
                      ${tableNames.map(name => 
                        `<option value="${name}" ${name === selectedTable ? 'selected' : ''}>${name}</option>`
                      ).join('')}
                    </select>
                  </div>
                </div>
                <div className="records-content">
                  <div className="tree-view">
                    ${treeData.map(node => renderTreeNodeHtml(node)).join('')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      
      // Set up tab switching in the nested editor
      const tabButtons = nestedEditorContainerRef.current.querySelectorAll('.tab-btn');
      tabButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          const tabName = (btn as HTMLElement).dataset.tab;
          
          // Update tab buttons
          tabButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          
          // Show/hide panels
          const styleManager = document.getElementById(`style-manager-${nestedEditorId}`);
          const layersContainer = document.getElementById(`layers-container-${nestedEditorId}`);
          const recordsContainer = document.getElementById(`records-${nestedEditorId}`);
          
          if (styleManager && layersContainer && recordsContainer) {
            if (tabName === 'properties') {
              styleManager.style.display = 'block';
              layersContainer.style.display = 'none';
              recordsContainer.style.display = 'none';
            } else if (tabName === 'objects') {
              styleManager.style.display = 'none';
              layersContainer.style.display = 'block';
              recordsContainer.style.display = 'none';
            } else if (tabName === 'records') {
              styleManager.style.display = 'none';
              layersContainer.style.display = 'none';
              recordsContainer.style.display = 'block';
            }
          }
        });
      });
      
      // Set up nested table selector event listener
      const tableSelector = nestedEditorContainerRef.current.querySelector('.nested-table-select') as HTMLSelectElement;
      if (tableSelector) {
        tableSelector.addEventListener('change', (e) => {
          const newSelectedTable = (e.target as HTMLSelectElement).value;
          setSelectedTable(newSelectedTable);
        });
      }
    }
    
    // Helper function to render tree nodes as HTML string for the nested editor
    function renderTreeNodeHtml(node: TreeNode, level: number = 0): string {
      const isExpanded = expandedKeys.has(node.key);
      const paddingLeft = level * 20;
      
      // Determine if this node can be dragged (only leaf nodes with values)
      const isDraggable = node.isLeaf && node.value !== null;
      
      let html = `
        <div class="tree-node">
          <div class="tree-node-content" style="padding-left: ${paddingLeft}px;" 
               ${isDraggable ? 'draggable="true" data-path="' + node.path + '" data-value="' + node.value + '"' : ''}
          >
      `;
      
      if (node.children.length > 0) {
        html += `
          <span class="expand-icon ${isExpanded ? 'expanded' : ''}">
            ${isExpanded ? '▼' : '►'}
          </span>
        `;
      } else {
        html += `<span class="leaf-icon">•</span>`;
      }
      
      html += `
        <span class="node-label">${node.label}</span>
        ${node.isLeaf && node.value !== null ? `<span class="node-value">${node.value}</span>` : ''}
      </div>
      `;
      
      if (isExpanded && node.children.length > 0) {
        html += `<div class="tree-node-children">`;
        node.children.forEach(childNode => {
          html += renderTreeNodeHtml(childNode, level + 1);
        });
        html += `</div>`;
      }
      
      html += `</div>`;
      return html;
    }
    
    // Clean up frameContent to ensure it's valid HTML content
    let contentToUse = frameContent.trim();
    
    // If nothing is found, use empty content instead of breaking the editor
    if (!contentToUse) {
      contentToUse = '<div style="min-height: 50px;"></div>';
    }
    
    // Check for cached JSON structure from previous editing session (more reliable)
    const cachedJson = sessionStorage.getItem(`frame-content-${frameId}-json`);
    if (cachedJson) {
      try {
        // Make sure it's valid JSON before using it
        JSON.parse(cachedJson);
        // We'll use this later when initializing the editor
        console.log("Using cached JSON structure for frame:", frameId);
      } catch (err) {
        console.warn("Invalid cached JSON for frame, falling back to HTML:", err);
      }
    }
    
    // Fall back to cached HTML if JSON isn't available
    const cachedHtml = sessionStorage.getItem(`frame-content-${frameId}-html`);
    if (!cachedJson && cachedHtml) {
      contentToUse = cachedHtml;
    }
    
    // Check for cached height (for auto-height frames)
    if (frameDimensions?.autoHeight) {
      const cachedHeight = sessionStorage.getItem(`frame-content-${frameId}-height`);
      if (cachedHeight) {
        const frameHeightDisplay = document.querySelector('.frame-height');
        if (frameHeightDisplay) {
          frameHeightDisplay.textContent = cachedHeight;
        }
        
        const framePreviewWrapper = document.querySelector('.frame-preview-wrapper');
        if (framePreviewWrapper) {
          (framePreviewWrapper as HTMLElement).style.height = cachedHeight;
        }
      }
    }
    
    // Create custom editor configuration that simulates the frame's dimensions
    const editorConfig = {
      container: `#${nestedEditorId}`,
      height: "100%",
      width: "100%", 
      fromElement: false,
      storageManager: { autoload: false },
      
      // Use relative positioning for the frame editor to match the frame context
      dragMode: 'absolute' as const,
      deviceManager: { devices: [] },
      
      // Configure canvas to match frame dimensions
      canvas: {
        styles: [],
        scripts: [],
        // Important: Set the frame size to match the parent frame
        frameStyle: frameDimensions ? `
          :root { 
            box-sizing: border-box;
          }
          html, body { 
            margin: 0; 
            padding: 0;
            width: 100%;
            height: 100%;
          }
        ` : '',
      },
      
      // Block manager configuration (kept from main editor)
      blockManager: {
        appendTo: `#blocks-${nestedEditorId}`,
        blocks: [
          {
            id: 'text',
            label: 'Text Box',
            category: 'Basic',
            content: {
              type: 'text',
              content: 'Insert your text here',
              style: { padding: '10px', minHeight: '50px' }
            },
            media: '<i class="fa fa-text-width"></i>'
          },
          {
            id: 'heading',
            label: 'Heading',
            category: 'Basic',
            content: {
              type: 'text',
              content: '<h1>Heading</h1>',
              style: { padding: '10px', minHeight: '50px' }
            },
            media: '<i class="fa fa-header"></i>'
          },
          {
            id: 'image',
            label: 'Image',
            category: 'Basic',
            select: true,
            content: { type: 'image' },
            media: '<i class="fa fa-image"></i>'
          },
          {
            id: 'table',
            label: 'Table',
            category: 'Structure',
            content: {
              type: 'table',
              style: { width: '100%' },
              components: [
                {
                  type: 'thead',
                  components: [
                    {
                      type: 'row',
                      components: [
                        { type: 'cell', content: 'Header 1', tagName: 'th' },
                        { type: 'cell', content: 'Header 2', tagName: 'th' },
                        { type: 'cell', content: 'Header 3', tagName: 'th' }
                      ]
                    }
                  ]
                },
                {
                  type: 'tbody',
                  components: [
                    {
                      type: 'row',
                      components: [
                        { type: 'cell', content: 'Cell 1' },
                        { type: 'cell', content: 'Cell 2' },
                        { type: 'cell', content: 'Cell 3' }
                      ]
                    },
                    {
                      type: 'row',
                      components: [
                        { type: 'cell', content: 'Cell 4' },
                        { type: 'cell', content: 'Cell 5' },
                        { type: 'cell', content: 'Cell 6' }
                      ]
                    }
                  ]
                }
              ]
            },
            media: '<i class="fa fa-table"></i>'
          },
          {
            id: 'frame',
            label: 'Frame',
            category: 'Structure',
            content: {
              type: 'frame',
              style: { 
                padding: '20px',
                minHeight: '100px',
                backgroundColor: '#e8f4fc',
                border: '1px dashed #3498db'
              }
            },
            media: '<i class="fa fa-window-maximize"></i>'
          }
        ]
      },
      
      // Configure panels with save and export buttons
      panels: {
        defaults: [
          {
            id: 'panel-top',
            el: `.panel-top-${nestedEditorId}`,
            buttons: [
              {
                id: 'save',
                className: 'btn-save',
                label: 'Save',
                command: 'save-page',
              }
            ],
          }
        ]
      },
      
      // Enable style manager
      styleManager: {
        appendTo: `#style-manager-${nestedEditorId}`,
        sectors: [
          {
            name: 'Typography',
            open: false,
            buildProps: ['font-family', 'font-size', 'font-weight', 'letter-spacing', 'color', 'text-align', 'text-shadow', 'line-height']
          },
          {
            name: 'Dimension',
            open: false,
            buildProps: ['width', 'height', 'max-width', 'min-height', 'margin', 'padding']
          },
          {
            name: 'Decorations',
            open: false,
            buildProps: ['background-color', 'border', 'border-radius', 'box-shadow']
          },
          {
            name: 'Position',
            open: false,
            buildProps: ['position', 'top', 'left', 'bottom', 'right']
          }
        ]
      },

      // Enable layer manager
      layerManager: {
        appendTo: `#layers-container-${nestedEditorId}`
      },
      
      // Use plugins
      plugins: [],
      
      // Start with empty container - we'll load components after initialization
      components: '',
    };
    
    // Initialize the nested editor with the frame-specific configuration
    const nestedEditor = grapesjs.init(editorConfig);
    
    // IMPROVED COMPONENT LOADING: Now load content with more reliable methods
    if (cachedJson) {
      try {
        // Load the cached component structure (preserves component types)
        const componentsJson = JSON.parse(cachedJson);
        
        // Log component count for debugging
        console.log(`Loading ${Array.isArray(componentsJson) ? componentsJson.length : 'unknown'} components from JSON for frame ${frameId}`);
        
        // First, try to load components directly
        nestedEditor.setComponents(componentsJson);
        
        // Check if components were actually loaded
        setTimeout(() => {
          const loadedCount = nestedEditor.getComponents().length;
          console.log(`Actual component count after loading: ${loadedCount}`);
          
          // If no components were loaded properly, try HTML fallback immediately
          if (loadedCount === 0 && cachedHtml && cachedHtml.trim() !== '') {
            console.warn('No components loaded from JSON, falling back to HTML');
            nestedEditor.setComponents(cachedHtml);
            console.log('Loaded content from HTML fallback');
          }
        }, 100);
      } catch (err) {
        console.error("Error loading components from JSON:", err);
        // Fall back to HTML if JSON loading fails
        const canvasHtml = sessionStorage.getItem(`frame-content-${frameId}-canvas-html`);
        
        // Try regular HTML first
        if (cachedHtml && cachedHtml.trim() !== '') {
          nestedEditor.setComponents(cachedHtml);
          console.log('Loaded content from HTML fallback after JSON error');
        } 
        // Then try canvas HTML if regular HTML fails
        else if (canvasHtml && canvasHtml.trim() !== '') {
          nestedEditor.setComponents(canvasHtml);
          console.log('Loaded content from canvas HTML backup');
        }
        // If all else fails, use the provided content
        else {
          nestedEditor.setComponents(contentToUse);
          console.log('Loaded content from original frame content');
        }
      }
    } else if (cachedHtml && cachedHtml.trim() !== '') {
      // No cached JSON, try cached HTML
      nestedEditor.setComponents(cachedHtml);
      console.log('Loaded content from HTML (no JSON available)');
    } else {
      // No cached content, use the HTML content provided
      nestedEditor.setComponents(contentToUse);
      console.log('Loaded content from original frame content (no cache)');
    }
    
    // Load any cached CSS
    const cachedCss = sessionStorage.getItem(`frame-content-${frameId}-css`);
    if (cachedCss) {
      nestedEditor.setStyle(cachedCss);
    }
    
    // Add save command using our improved save function
    nestedEditor.Commands.add("save-page", {
      run(editor) {
        saveFrameContent(editor, frameId, frameDimensions);
        alert("Frame content saved!");
      },
    });
    
    // Function to calculate and update frame dimensions based on content
    const updateFrameDimensions = (editor: any) => {
      if (!dimensionsToUse?.autoHeight) return;
      
      try {
        // Get the canvas document and body
        const canvas = editor.Canvas.getDocument();
        if (!canvas || !canvas.body) return;
        
        // Get the actual height of the content
        const contentHeight = canvas.body.scrollHeight;
        
        // Only update if content height is reasonable (not too small and not 0)
        if (contentHeight < 50) {
          console.warn('Suspiciously small content height detected:', contentHeight);
          return;
        }
        
        // Display the content height
        const frameHeightDisplay = document.querySelector('.frame-height');
        const framePreviewWrapper = document.querySelector('.frame-preview-wrapper') as HTMLElement;
        
        if (frameHeightDisplay && framePreviewWrapper) {
          const heightWithUnit = contentHeight + 'px';
          
          // Get current height to compare
          const currentHeight = framePreviewWrapper.style.height;
          const currentHeightValue = parseInt(currentHeight) || 0;
          
          // Only grow, never shrink - only apply new height if it's larger than current
          if (!currentHeight || currentHeightValue < contentHeight) {
            console.log(`Frame growing from ${currentHeight} to ${heightWithUnit}`);
            
            // Update display and frame
          frameHeightDisplay.textContent = heightWithUnit;
            framePreviewWrapper.style.height = heightWithUnit;
            
            // Save the height to session storage - but preserve the original width
            const updatedDimensions = {
              ...dimensionsToUse,
              height: heightWithUnit
            };
            
            // We don't call preserveFrameDimensions here because that would 
            // overwrite the user's manually set dimensions
            // Only update the calculated auto-height
            sessionStorage.setItem(`frame-content-${frameId}-height`, heightWithUnit);
          } else {
            console.log(`Skipping height update: current=${currentHeight}, calculated=${heightWithUnit}`);
          }
        }
      } catch (error) {
        console.error("Error calculating content dimensions:", error);
      }
    };
    
    // Monitor changes to update dimensions if auto-height is enabled
    if (dimensionsToUse?.autoHeight) {
      // Use a debounced version of the update function to prevent too many updates
      let updateTimeout: NodeJS.Timeout | null = null;
      const debouncedUpdate = () => {
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(() => {
          updateFrameDimensions(nestedEditor);
        }, 200);
      };
      
      nestedEditor.on('component:update', debouncedUpdate);
      nestedEditor.on('canvas:drop', debouncedUpdate);
      nestedEditor.on('component:add', debouncedUpdate);
      nestedEditor.on('component:remove', debouncedUpdate);
      
      // Initial height calculation - wait a bit longer for initial render
      setTimeout(() => updateFrameDimensions(nestedEditor), 500);
    }
    
    // Add double-click handler to make frame component editing work properly 
    nestedEditor.on('component:dblclick', (component: any) => {
      if (component.get('type') === 'frame') {
        nestedEditor.runCommand('frame-edit', { frameComponent: component });
      }
    });
    
    // Set up auto-save to prevent loss of content
    const autoSaveInterval = setInterval(() => {
      try {
        saveFrameContent(nestedEditor, frameId, frameDimensions);
      } catch (err) {
        console.warn('Auto-save failed:', err);
      }
    }, 5000); // Save every 5 seconds
    
    // Keep track of this new editor instance
    setEditorInstances(prev => [
      ...prev, 
      { 
        id: nestedEditorId, 
        editor: nestedEditor, 
        containerEl: nestedEditorContainerRef.current as HTMLElement,
        parentFrameId: frameId,
        autoSaveInterval,
        frameDimensions
      }
    ]);
    
    // Update the active editor index
    setActiveEditorIndex(prev => prev + 1);
    
    // Update breadcrumbs
    setEditorBreadcrumbs(prev => [...prev, `Frame ${prev.length}`]);
    
    // Show the nested editor
    setShowNestedEditor(true);
    
    // Listen for manual resizing of the frame preview 
    const framePreviewWrapper = document.querySelector('.frame-preview-wrapper');
    if (framePreviewWrapper) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          // When the frame preview is manually resized, update the stored dimensions
          if (dimensionsToUse) {
            const newWidth = `${Math.round(entry.contentRect.width)}px`;
            const newHeight = `${Math.round(entry.contentRect.height)}px`;
            
            // Only update if this was likely a manual resize (more than 5px difference)
            const currentWidth = dimensionsToUse.width;
            const currentHeight = dimensionsToUse.height;
            
            const widthChanged = Math.abs(parseInt(newWidth) - parseInt(currentWidth)) > 5;
            const heightChanged = Math.abs(parseInt(newHeight) - parseInt(currentHeight)) > 5;
            
            // For height specifically, check if this is likely a manual reduction in size
            // Detect manual resize by checking mouse state or frame being actively dragged
            const isManualResize = document.querySelector('.gjs-resizer-active') !== null || 
                                 document.activeElement?.classList.contains('frame-preview-wrapper');
            
            // Never automatically reduce height, but allow width changes and manual height changes
            const shouldUpdateHeight = heightChanged && (
              isManualResize || // Always allow manual resize
              parseInt(newHeight) > parseInt(currentHeight) // Or auto-grow only
            );
            
            if (widthChanged || shouldUpdateHeight) {
              console.log('Frame resized:', { 
                newWidth, newHeight, 
                isManualResize,
                widthChanged,
                heightChanged,
                shouldUpdateHeight
              });
              
              // Update the dimension displays
              const frameWidthDisplay = document.querySelector('.frame-width');
              const frameHeightDisplay = document.querySelector('.frame-height');
              
              if (frameWidthDisplay && widthChanged) frameWidthDisplay.textContent = newWidth;
              if (frameHeightDisplay && shouldUpdateHeight) frameHeightDisplay.textContent = newHeight;
              
              // Store the new dimensions
              const updatedDimensions = {
                ...dimensionsToUse,
                width: widthChanged ? newWidth : dimensionsToUse.width,
                height: shouldUpdateHeight ? newHeight : dimensionsToUse.height
              };
              
              preserveFrameDimensions(frameId, updatedDimensions);
            }
                }
              }
            });
            
      // Start observing the frame preview wrapper
      resizeObserver.observe(framePreviewWrapper as Element);
      
      // Clean up the observer when editor is closed
      const cleanup = () => {
        resizeObserver.disconnect();
      };
      
      // Store cleanup function to be called when returning to parent
      (framePreviewWrapper as any).cleanup = cleanup;
    }

    // Handle record drag and drop in the nested editor
    const setupNestedDragDrop = () => {
      if (!nestedEditorContainerRef.current) return;
      
      // Set up delegated event handler for dragstart
      nestedEditorContainerRef.current.addEventListener('dragstart', (e: DragEvent) => {
        const target = e.target as HTMLElement;
        
        // Check if this is a draggable tree node
        if (target && target.classList.contains('tree-node-content') && 
            target.getAttribute('draggable') === 'true') {
          
          // Get the record path and value from data attributes
          const path = target.getAttribute('data-path');
          const value = target.getAttribute('data-value');
          
          if (path && value && e.dataTransfer) {
            // Set drag data
            e.dataTransfer.setData('text/plain', JSON.stringify({
              type: 'record',
              path: path,
              value: value
            }));
            e.dataTransfer.effectAllowed = 'copy';
            
            // Add dragging class
            target.classList.add('dragging');
          }
        }
      });
      
      // Handle dragend to remove dragging class
      nestedEditorContainerRef.current.addEventListener('dragend', (e: DragEvent) => {
        const target = e.target as HTMLElement;
        if (target && target.classList.contains('tree-node-content')) {
          target.classList.remove('dragging');
        }
      });
    };
    
    // Set a timeout to initialize drag and drop after the HTML is rendered
    setTimeout(() => {
      setupNestedDragDrop();
    }, 500);
  };

  // Initialize the main editor
  useEffect(() => {
    if (editorInstances.length === 0) {
      // Create the main editor container
      const mainEditorId = 'main-editor';
      
      // Initialize the editor with page manager
      const mainEditor = initializeEditor(mainEditorId);
      
      // Add to editor instances
      setEditorInstances([{ 
        id: mainEditorId, 
        editor: mainEditor, 
        containerEl: document.getElementById(mainEditorId) as HTMLElement 
      }]);

      // Initialize page manager
      const pageManager = mainEditor.Pages;
      
      // Add initial page if none exists
      if (pageManager.getAll().length === 0) {
        const initialPage = pageManager.add({
          id: `page-${Date.now()}`,
          name: 'Page 1',
          component: '<div>Page content</div>',
          styles: '',
        });
        setCurrentPage(initialPage);
        setPages([initialPage]);
        // Set initial breadcrumb
        setEditorBreadcrumbs(['Page 1']);
      } else {
        const pages = pageManager.getAll();
        setPages(pages);
        const selectedPage = pageManager.getSelected();
        setCurrentPage(selectedPage);
        // Set breadcrumb based on selected page
        setEditorBreadcrumbs([selectedPage.getName()]);
      }

      // Add page manager commands
      mainEditor.Commands.add('add-page', {
        run: (editor: any) => {
          const pages = editor.Pages;
          const newPage = pages.add({
            id: `page-${Date.now()}`,
            name: pages.getAll().length === 0 ? 'Page 1' : `Page ${pages.getAll().length + 1}`,
            component: '<div>New page content</div>',
            styles: '',
          });
          pages.select(newPage);
          setPages(pages.getAll());
          setCurrentPage(newPage);
          // Update breadcrumbs with new page name
          setEditorBreadcrumbs([newPage.getName()]);
        }
      });

      mainEditor.Commands.add('select-page', {
        run: (editor: any, sender: any, options: { page: any }) => {
          const { page } = options;
          editor.Pages.select(page);
          setCurrentPage(page);
          // Update breadcrumbs with selected page name
          setEditorBreadcrumbs([page.getName()]);
        }
      });

      mainEditor.Commands.add('delete-page', {
        run: (editor: any, sender: any, options: { page: any }) => {
          const { page } = options;
          if (editor.Pages.getAll().length > 1) {
            editor.Pages.remove(page);
            const remainingPages = editor.Pages.getAll();
            setPages(remainingPages);
            const newCurrentPage = editor.Pages.getSelected();
            setCurrentPage(newCurrentPage);
            // Update breadcrumbs with current page name
            setEditorBreadcrumbs([newCurrentPage.getName()]);
          } else {
            alert('Cannot delete the last page');
          }
        }
      });

      mainEditor.Commands.add('rename-page', {
        run: (editor: any, sender: any, options: { page: any }) => {
          const { page } = options;
          const newName = prompt('Enter new page name:', page.getName());
          if (newName) {
            page.setName(newName);
            setPages([...editor.Pages.getAll()]);
            // Update breadcrumbs with new page name
            setEditorBreadcrumbs([newName]);
          }
        }
      });

      // Listen for page changes
      mainEditor.on('page', () => {
        setPages(mainEditor.Pages.getAll());
        setCurrentPage(mainEditor.Pages.getSelected());
      });
      
      // Store the main editor reference
      editorRef.current = mainEditor;
    }
  }, []);

  // Function to generate PDF from all pages
  const generatePDF = async () => {
    try {
      setIsGeneratingPdf(true);
      
      // Dynamically import jsPDF and html2canvas
      const jsPDFModule = await import('jspdf');
      const html2canvasModule = await import('html2canvas');
      
      const jsPDF = jsPDFModule.default;
      const html2canvas = html2canvasModule.default;
      
      const editor = editorRef.current;
      if (!editor) {
        throw new Error("Editor not initialized");
      }

      // Get all pages
      const allPages = editor.Pages.getAll();
      if (allPages.length === 0) {
        throw new Error("No pages to preview");
      }
      
      // Store current page to restore later
      const currentPageId = editor.Pages.getSelected().getId();
      
      // Initialize PDF (A4 format)
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });
      
      // PDF dimensions (A4)
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      // Process each page
      let isFirstPage = true;
      for (const page of allPages) {
        // Add a new page if this isn't the first page
        if (!isFirstPage) {
          pdf.addPage();
        } else {
          isFirstPage = false;
        }
        
        // Switch to this page
        editor.Pages.select(page);
        
        // Wait for the canvas to render
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Get the canvas element
        const canvas = editor.Canvas.getFrameEl().contentDocument.body;
        if (!canvas) {
          continue; // Skip if no canvas
        }
        
        // Convert canvas to image
        const canvasImage = await html2canvas(canvas, {
          scale: 2,
          logging: false,
          useCORS: true,
          allowTaint: true
        });
        
        // Calculate the required scaling to fit the PDF
        const imgWidth = pdfWidth - 28; // 14mm margin on each side
        const imgHeight = (canvasImage.height * imgWidth) / canvasImage.width;
        
        // Add canvas image to PDF
        const imgData = canvasImage.toDataURL('image/jpeg', 0.95);
        pdf.addImage(imgData, 'JPEG', 14, 14, imgWidth, imgHeight);
      }
      
      // Restore original page
      editor.Pages.select(currentPageId);
      
      // Create a blob URL for the PDF
      const pdfBlob = pdf.output('blob');
      const url = URL.createObjectURL(pdfBlob);
      
      // Update state to show the PDF
      setPdfUrl(url);
      setShowPdfPreview(true);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Error generating PDF preview. Please try again.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // Convert components to XML format (keeping this function from the original code)
  const convertToXML = (components: any): string => {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<components>\n';
    
    const processComponent = (component: any, indent: string = '  '): string => {
      let compXml = '';
      const type = component.get('type');
      const attributes = component.getAttributes();
      const style = component.getStyle();
      
      // Start tag with type
      compXml += `${indent}<component type="${type}">\n`;
      
      // Add attributes section if any
      if (Object.keys(attributes).length) {
        compXml += `${indent}  <attributes>\n`;
        for (const [key, value] of Object.entries(attributes)) {
          compXml += `${indent}    <${key}>${value}</${key}>\n`;
        }
        compXml += `${indent}  </attributes>\n`;
      }
      
      // Add style section if any
      if (Object.keys(style).length) {
        compXml += `${indent}  <style>\n`;
        for (const [prop, value] of Object.entries(style)) {
          compXml += `${indent}    <${prop}>${value}</${prop}>\n`;
        }
        compXml += `${indent}  </style>\n`;
      }
      
      // Add content if available
      const content = component.get('content');
      if (content) {
        // Escape HTML content
        const escapedContent = content
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
        
        compXml += `${indent}  <content><![CDATA[${escapedContent}]]></content>\n`;
      }
      
      // Process children components
      const components = component.get('components');
      if (components && components.length) {
        compXml += `${indent}  <children>\n`;
        components.forEach((child: any) => {
          compXml += processComponent(child, indent + '    ');
        });
        compXml += `${indent}  </children>\n`;
      }
      
      // Close component tag
      compXml += `${indent}</component>\n`;
      
      return compXml;
    };
    
    // Process all top-level components
    components.forEach((component: any) => {
      xml += processComponent(component);
    });
    
    xml += '</components>';
    return xml;
  };

  const toggleNode = (node: TreeNode) => {
    const newExpandedKeys = new Set(expandedKeys);
    if (newExpandedKeys.has(node.key)) {
      newExpandedKeys.delete(node.key);
    } else {
      newExpandedKeys.add(node.key);
    }
    setExpandedKeys(newExpandedKeys);
  };

  const renderTreeNode = (node: TreeNode, level: number = 0) => {
    const isExpanded = expandedKeys.has(node.key);

    // Determine if this node can be dragged (only leaf nodes with values)
    const isDraggable = node.isLeaf && node.value !== null;

    return (
      <div key={node.key} className="tree-node">
        <div
          className="tree-node-content"
          style={{ paddingLeft: `${level * 20}px` }}
          draggable={isDraggable}
          onDragStart={isDraggable ? (e) => {
            e.stopPropagation();
            if (e.dataTransfer) {
              // Set drag data with path and value
              e.dataTransfer.setData('text/plain', JSON.stringify({
                type: 'record',
                path: node.path,
                value: node.value
              }));
              e.dataTransfer.effectAllowed = 'copy';
              // Add a class to show it's being dragged
              (e.currentTarget as HTMLElement).classList.add('dragging');
            }
          } : undefined}
          onDragEnd={(e) => {
            // Remove dragging class
            (e.currentTarget as HTMLElement).classList.remove('dragging');
          }}
        >
          {node.children.length > 0 ? (
            <span
              className={`expand-icon ${isExpanded ? 'expanded' : ''}`}
              onClick={() => toggleNode(node)}
            >
              {isExpanded ? '▼' : '►'}
            </span>
          ) : (
            <span className="leaf-icon">•</span>
          )}

          <span className="node-label">{node.label}</span>

          {node.isLeaf && node.value !== null && (
            <span className="node-value">{node.value}</span>
          )}
        </div>

        {isExpanded && node.children.length > 0 && (
          <div className="tree-node-children">
            {node.children.map(childNode => renderTreeNode(childNode, level + 1))}
          </div>
        )}
      </div>
    );
  };

  // Handle tab switching and ensure Style Manager renders correctly
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    
    if (activeTab === 'properties') {
      // Use a timeout to ensure DOM is updated before re-rendering
      setTimeout(() => {
        // Update the StyleManager's container reference
        if (styleManagerRef.current) {
          // Clear and re-append the style manager
          const styleManager = editor.StyleManager;
          styleManager.config.appendTo = styleManagerRef.current;
          
          // Force full re-render
          styleManager.render();
          
          // If a component was selected, reselect it to refresh styles
          if (selectedComponentRef.current) {
            editor.select(selectedComponentRef.current);
          }
        }
      }, 100);
    } else if (activeTab === 'objects') {
      // Use a timeout to ensure DOM is updated before re-rendering
      setTimeout(() => {
        // Update the LayerManager's container reference
        if (layersRef.current) {
          // Access the Layer Manager
          const layerManager = editor.LayerManager;
          layerManager.config.appendTo = layersRef.current;
          
          // Force full re-render
          layerManager.render();
        }
      }, 100);
    }
  }, [activeTab]);
  
  // Add a new function to better preserve frame dimensions
  const preserveFrameDimensions = (frameId: string, dimensions: any) => {
    try {
      // Store the original dimensions separately from auto-calculated height
      // This ensures we maintain user-set dimensions between editing sessions
      sessionStorage.setItem(`frame-original-dimensions-${frameId}`, JSON.stringify({
        width: dimensions.width,
        height: dimensions.height,
        padding: dimensions.padding,
        autoHeight: dimensions.autoHeight
      }));
      console.log('Preserved original dimensions for frame:', frameId, dimensions);
    } catch (err) {
      console.error('Error preserving frame dimensions:', err);
    }
  };
  
  return (
    <div className="editor-container">
      {/* Top panel with improved styling */}
      <div className="panel-top">
        <div className="editor-logo">
          <FontAwesomeIcon icon={faPencilAlt} /> Website Builder
        </div>
      </div>

      {/* Breadcrumb navigation - now always visible */}
      <div className="editor-breadcrumbs">
        {showNestedEditor ? (
          // Show nested editor breadcrumbs
          <>
            {editorBreadcrumbs.map((crumb, index) => (
              <span key={index} className="breadcrumb-item">
                {index > 0 && <span className="breadcrumb-separator">/</span>}
                <span 
                  className={`breadcrumb-text ${index === activeEditorIndex ? 'active' : ''}`}
                  onClick={() => {
                    if (index < activeEditorIndex) {
                      for (let i = activeEditorIndex; i > index; i--) {
                        returnToParentEditor();
                      }
                    }
                  }}
                >
                  {crumb}
                </span>
              </span>
            ))}
            {activeEditorIndex > 0 && (
              <button className="back-to-parent" onClick={returnToParentEditor}>
                <FontAwesomeIcon icon={faArrowUp} /> Back to Parent
              </button>
            )}
          </>
        ) : (
          // Show current page name when not in nested editor
          <span className="breadcrumb-item">
            <span className="breadcrumb-text active">
              {currentPage?.getName() || 'Page 1'}
            </span>
          </span>
        )}
        <div className="breadcrumb-actions">
          <button 
            className="btn-save" 
            onClick={() => editorInstances[activeEditorIndex]?.editor.runCommand('save-page')}
          >
            <FontAwesomeIcon icon={faSave} /> Save
          </button>
          <button 
            className="btn-export" 
            onClick={() => editorInstances[activeEditorIndex]?.editor.runCommand('export-xml')}
          >
            <FontAwesomeIcon icon={faFileExport} /> Export XML
          </button>
          <button 
            className="btn-preview" 
            onClick={generatePDF}
            disabled={isGeneratingPdf}
          >
            <FontAwesomeIcon icon={faFileAlt} /> Preview
          </button>
        </div>
      </div>

      {/* Conditional rendering of the main or nested editor */}
      <div className={`editor-main ${showNestedEditor ? 'hidden' : ''}`}>
        {/* Left sidebar - Block manager with better styling */}
        <div className="panel-left">
          <div className="panel-header">
            <FontAwesomeIcon icon={faSquare} /> Blocks
          </div>
          <div id="blocks-main-editor" className="panel-blocks"></div>
        </div>

        {/* Main editor container */}
        <div id="main-editor" className="editor-canvas"></div>

        {/* Right sidebar with tabs */}
        <div className="panel-right">
          <div className="panel-tabs">
            <button 
              className={`tab-btn ${activeTab === 'properties' ? 'active' : ''}`}
              onClick={() => setActiveTab('properties')}
            >
              <FontAwesomeIcon icon={faPencilAlt} /> Properties
            </button>
            <button 
              className={`tab-btn ${activeTab === 'objects' ? 'active' : ''}`}
              onClick={() => setActiveTab('objects')}
            >
              <FontAwesomeIcon icon={faLayerGroup} /> Objects
            </button>
            <button 
              className={`tab-btn ${activeTab === 'records' ? 'active' : ''}`}
              onClick={() => setActiveTab('records')}
            >
              <FontAwesomeIcon icon={faDatabase} /> Records
            </button>
          </div>
          <div className="panel-content">
            {/* Conditional rendering of panels */}
            <div 
              id="style-manager-main-editor" 
              ref={styleManagerRef} 
              style={{ display: activeTab === 'properties' ? 'block' : 'none' }}
              className="style-manager-container"
            ></div>
            <div 
              id="layers-container-main-editor" 
              ref={layersRef}
              style={{ display: activeTab === 'objects' ? 'block' : 'none' }}
              className="layers-container"
            ></div>
            <div 
              id="records" 
              style={{ display: activeTab === 'records' ? 'block' : 'none' }}
              className="records-container"
            >
              <div className="records-header">
                <h3><FontAwesomeIcon icon={faDatabase} /> XML Records</h3>
                <div className="table-selector">
                  <label htmlFor="table-select">Select XML Table:</label>
                  <select 
                    id="table-select" 
                    value={selectedTable}
                    onChange={(e) => setSelectedTable(e.target.value)}
                    disabled={isLoadingTables}
                  >
                    {isLoadingTables ? (
                      <option>Loading tables...</option>
                    ) : tableNames.length === 0 ? (
                      <option>No tables available</option>
                    ) : (
                      tableNames.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))
                    )}
                  </select>
                </div>
              </div>
              <div className="records-content">
                {isLoadingRecords ? (
                  <div className="loading">Loading records...</div>
                ) : treeData.length === 0 ? (
                  <div className="no-records">No records found for this table.</div>
                ) : (
                  <div className="tree-view">
                    {treeData.map(node => renderTreeNode(node))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Nested editor container (shown when editing a frame) */}
      <div 
        className={`nested-editor-main ${showNestedEditor ? '' : 'hidden'}`}
        ref={nestedEditorContainerRef}
      ></div>

      {/* Page Manager Panel */}
      <div className="page-manager-panel">
        <div className="page-list">
          {pages.map((page) => (
            <div 
              key={page.getId()} 
              className={`page-item ${currentPage?.getId() === page.getId() ? 'active' : ''}`}
              onClick={() => {
                editorRef.current?.runCommand('select-page', { page });
                // Update breadcrumbs with current page name
                setEditorBreadcrumbs([page.getName()]);
              }}
            >
              <span className="page-name">{page.getName()}</span>
              <div className="page-actions">
                <button 
                  className="rename-page"
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent page selection when clicking rename
                    editorRef.current?.runCommand('rename-page', { page });
                  }}
                >
                  <FontAwesomeIcon icon={faPencilAlt} />
                </button>
                <button 
                  className="delete-page"
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent page selection when clicking delete
                    editorRef.current?.runCommand('delete-page', { page });
                  }}
                >
                  <FontAwesomeIcon icon={faTrash} />
                </button>
              </div>
            </div>
          ))}
          <button 
            className="add-page-btn"
            onClick={() => editorRef.current?.runCommand('add-page')}
          >
            <FontAwesomeIcon icon={faPlus} /> Add Page
          </button>
        </div>
      </div>

      {/* XML Export Modal */}
      {showXmlExport && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">
              <h3><FontAwesomeIcon icon={faFileExport} /> XML Export</h3>
              <button 
                className="close-btn"
                onClick={() => setShowXmlExport(false)}
              >×</button>
            </div>
            <div className="modal-content">
              <pre className="xml-code">{xmlCode}</pre>
            </div>
            <div className="modal-footer">
              <button 
                className="copy-btn"
                onClick={() => {
                  navigator.clipboard.writeText(xmlCode);
                  alert("XML copied to clipboard!");
                }}
              >
                Copy to Clipboard
              </button>
              <button 
                className="close-btn"
                onClick={() => setShowXmlExport(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Generation Loading Indicator */}
      {isGeneratingPdf && (
        <div className="pdf-loading">
          Generating PDF preview...
        </div>
      )}

      {/* PDF Preview Modal */}
      {showPdfPreview && pdfUrl && (
        <div className="modal-overlay">
          <div className="modal-container pdf-preview-modal">
            <div className="modal-header">
              <h3><FontAwesomeIcon icon={faFileAlt} /> PDF Preview</h3>
              <button 
                className="close-btn"
                onClick={() => {
                  setShowPdfPreview(false);
                  if (pdfUrl) {
                    URL.revokeObjectURL(pdfUrl);
                    setPdfUrl(null);
                  }
                }}
              >×</button>
            </div>
            <div className="modal-content">
              <iframe 
                src={pdfUrl} 
                style={{ width: '100%', height: '100%', border: 'none' }}
              />
            </div>
            <div className="modal-footer">
              <a 
                href={pdfUrl} 
                download="website-preview.pdf" 
                className="download-btn"
              >
                <FontAwesomeIcon icon={faDownload} /> Download PDF
              </a>
              <button 
                className="close-btn"
                onClick={() => {
                  setShowPdfPreview(false);
                  if (pdfUrl) {
                    URL.revokeObjectURL(pdfUrl);
                    setPdfUrl(null);
                  }
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EditorGrapes;