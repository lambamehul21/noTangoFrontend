"use client"
import React, { useRef, useEffect, useState } from 'react'
import grapesjs, { Editor, ComponentView } from 'grapesjs'
//import gjsBlocksBasic from 'grapesjs-blocks-basic'
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
  faSquare
} from '@fortawesome/free-solid-svg-icons'
import { rootCertificates } from 'tls'

interface XmlRecord{
    id: string,
    path: string,
    value: string
}

interface TreeNode{
    key: string,
    label: string,
    path: string,
    value: string | null,
    children: TreeNode[],
    isLeaf: boolean,
    isExpanded?: boolean
}

// Add this type definition at the top of the file
type TextComponentModel = {
    defaults: {
        droppable: boolean;
        draggable: boolean;
        resizable: any;
        style: any;
    };
    init(this: any): void;
};

// Add GrapesJS type
type GrapesConfig = Parameters<typeof grapesjs.init>[0] & {
    layerManager: {
        appendTo: string | HTMLElement;
        scrollLayers?: boolean;
        showWrapper?: boolean;
        customRenderLayer?: (layer: any) => string;
    };
};

// UPDATED: Helper function to register the "frame" component type for any editor instance.
function registerFrameComponent(editor: Editor) {
    editor.DomComponents.addType('frame', {
        model: {
            defaults: {
                droppable: true,
                draggable: true,
                style: {
                    position: 'relative',
                    padding: '10px',
                    minHeight: '200px',
                    border: '2px dashed #ccc'
                }
            }
        },
        view: {
            events() {
                return {
                    dblclick: 'onDblClick'
                };
            },
            onDblClick(this: ComponentView, e: Event) {
                e.stopPropagation();
                const model = this.model;
                model.trigger('custom:nested-edit', model);
            }
        }
    });
}

const EditorGrapes = () => {
    const editorRef = useRef<any>(null);
    const [activeTab, setActiveTab] = useState('properties');
    const selectedComponentRef = useRef<any>(null);
    const styleManagerRef = useRef<HTMLDivElement>(null);
    const layersRef = useRef<HTMLDivElement>(null);
    const [xmlCode, setXmlCode] = useState<string>('');
    const [showXmlExport, setShowXmlExport] = useState<boolean>(false);
    const[tableNames, setTableNames] = useState<string[]>([]);
    const[selectedTable, setSelectedTable] = useState<string>('');
    const[isLoadingTables, setIsLoadingTables] = useState<boolean>(false);
    const[records, setRecords] = useState<XmlRecord[]>([]);
    const[isLoadingRecords, setIsLoadingRecords] = useState<boolean>(false)
    const [treeData, setTreeData] = useState<TreeNode[]>([]);
    const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
    const [nestedEditorVisible, setNestedEditorVisible] = useState<boolean>(false);
    const nestedEditorRef = useRef<any>(null);
    const nestedEditorContainerRef = useRef<HTMLDivElement>(null);
    const [nestedFrameComponent, setNestedFrameComponent] = useState<any>(null);

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
        const nodeMap : Record<string, TreeNode> = {'': root};
        const sortedRecords = [...records].sort((a,b)=>a.path.localeCompare(b.path));

        sortedRecords.forEach(record =>{
            const pathSegments = record.path.split('/');
            let currentPath = '';
            let parentPath = '';
            for(let i = 1; i < pathSegments.length; i++){
                const segment = pathSegments[i];
                if(!segment) continue;
                parentPath = currentPath;
                currentPath += '/'+ segment;
                if(!nodeMap[currentPath]){
                    const label = segment.replace(/\[\d+\]$/, '');
                    const newNode: TreeNode = {
                        key: currentPath,
                        label: label,
                        path: currentPath,
                        value: null,
                        children: [],
                        isLeaf: i == pathSegments.length -1
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
        if(!selectedTable) return;
        const fetchRecords = async() => {
            setIsLoadingRecords(true);
            try{
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
            }catch(error){
                console.log("Error fetching records", error)
            }finally{
                setIsLoadingRecords(false);
            }
        };
        fetchRecords();
    }, [selectedTable]);

    useEffect(() => {
        const fetchTableNames = async() => {
            setIsLoadingTables(true)
            try{
                const response = await axios.get(`http://localhost:8080/xml/tables`);
                setTableNames(response.data)
                if(response.data.length > 0){
                    setSelectedTable(response.data[0]);
                }
            }catch(error){
                console.log("error fetching table names", error);
            }finally{
                setIsLoadingTables(false)
            }
        };

        fetchTableNames();

    }, []);

    useEffect(() => {
        if (!editorRef.current) {
            // Initialize the editor
            const editor = grapesjs.init({
                container: "#gjs",
                height: "100vh",
                width: "100%",
                fromElement: true,
                storageManager: { autoload: false },
                
                dragMode: 'absolute',
                deviceManager: { devices: [] },
                
                canvas: {
                    styles: [],
                    scripts: [],
                },
                
                blockManager: {
                    appendTo: "#blocks",
                    blocks: [
                        // Block definitions with better icons
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
                        // NEW: Custom Frame block
                        {
                            id: 'frame',
                            label: 'Frame',
                            category: 'Structure',
                            content: {
                                type: 'frame',
                                style: { 
                                    padding: '10px',
                                    minHeight: '200px',
                                    border: '2px dashed #ccc',
                                    position: 'relative'
                                }
                            },
                            media: '<i class="fa fa-columns"></i>'
                        },
                        {
                            id: 'container',
                            label: 'Container',
                            category: 'Structure',
                            content: {
                                type: 'container',
                                style: { 
                                    padding: '20px',
                                    minHeight: '100px',
                                    backgroundColor: '#f7f7f7'
                                }
                            },
                            media: '<i class="fa fa-square-o"></i>'
                        }
                    ]
                },
                
                // Configure panels with export button
                panels: {
                    defaults: []  // Remove the default panel buttons since we're using our own in the React component
                },
                
                // Enable style manager with reference to our ref
                styleManager: {
                    appendTo: styleManagerRef.current || '#style-manager',
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

                // Configure layer manager with custom settings
                layerManager: {
                    appendTo: layersRef.current || '#layers-container',
                    scrollLayers: true,
                    showWrapper: true,
                    customRenderLayer: (layer: any) => {
                        const children = layer.get('components');
                        const hasChildren = children && children.length > 0;
                        const expanded = layer.get('open');
                        const selected = layer.get('selected');
                        
                        return `
                            <div class="gjs-layer ${expanded ? 'expanded' : ''} ${selected ? 'selected' : ''}">
                                <div class="gjs-layer-row">
                                    ${hasChildren ? `<span class="gjs-layer-caret ${expanded ? 'expanded' : ''}">▶</span>` : '<span class="gjs-layer-spacer"></span>'}
                                    <span class="gjs-layer-vis">👁</span>
                                    <span class="gjs-layer-name">${layer.get('name') || layer.get('type')}</span>
                                </div>
                                ${hasChildren ? '<div class="gjs-layer-children"></div>' : ''}
                            </div>
                        `;
                    }
                },

                // Add custom button to component toolbar
                componentManager: {
                    custom: true,
                    appendTo: '.gjs-cv-canvas'
                },

                // Add back save and export commands with proper syntax
                Commands: {
                    add: {
                        "save-page": {
                            run: (editor: Editor) => {
                                const html = editor.getHtml();
                                const css = editor.getCss();
                                console.log("HTML Output:", html);
                                console.log("CSS Output:", css);
                                alert("Page saved! Check the console for HTML and CSS output.");
                            },
                        },
                        "export-xml": {
                            run: (editor: Editor) => {
                                const componentsJSON = editor.getComponents();
                                const xmlOutput = convertToXML(componentsJSON);
                                setXmlCode(xmlOutput);
                                setShowXmlExport(true);
                            },
                        },
                    }
                }
            } as GrapesConfig);

            // NEW: Add custom component type "frame"
            editor.DomComponents.addType('frame', {
                model: {
                    defaults: {
                        // Allow dropping inside the frame and make it draggable
                        droppable: true,
                        draggable: true,
                        style: {
                            position: 'relative',
                            padding: '10px',
                            minHeight: '200px',
                            border: '2px dashed #ccc'
                        }
                    },
                },
                view: {
                    events() {
                        return {
                            dblclick: 'onDblClick'
                        };
                    },
                    onDblClick(this: ComponentView, e: Event) {
                        //e.stopPropagation();
                        console.log("hi")
                        const model = this.model;
                        model.trigger('custom:nested-edit', model);
                    }
                }
            });
            registerFrameComponent(editor);
            //can also make for all components
            editor.on('component:nested-edit', (component: any) => {
                if (component.get('type') === 'frame') {
                    console.log("Double-click event caught for frame, entering nested edit mode.");
                    setNestedFrameComponent(component);
                    setNestedEditorVisible(true);
                }
            });
            // Add save and export commands
            editor.Commands.add('save-page', {
                run(editor: Editor) {
                    const html = editor.getHtml();
                    const css = editor.getCss();
                    console.log("HTML Output:", html);
                    console.log("CSS Output:", css);
                    alert("Page saved! Check the console for HTML and CSS output.");
                }
            });

            editor.Commands.add('export-xml', {
                run(editor: Editor) {
                    const componentsJSON = editor.getComponents();
                    const xmlOutput = convertToXML(componentsJSON);
                    setXmlCode(xmlOutput);
                    setShowXmlExport(true);
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

            // Update layer manager to show/hide children
            editor.on('layer:click', (layer: any) => {
                const children = layer.get('components');
                if (children && children.length) {
                    layer.set('open', !layer.get('open'));
                    const childrenEl = layer.view.el.querySelector('.gjs-layer-children');
                    if (childrenEl) {
                        childrenEl.classList.toggle('expanded');
                    }
                }
            });

            // Add custom styles to layer manager
            editor.on('load', () => {
                const layersWrapper = editor.LayerManager.getRoot()?.view?.el;
                if (!layersWrapper) return;
                
                layersWrapper.classList.add('gjs-layers-custom');

                // Add expand/collapse functionality
                layersWrapper.addEventListener('click', (e: any) => {
                    const layerEl = e.target.closest('.gjs-layer');
                    if (layerEl) {
                        const caret = layerEl.querySelector('.gjs-layer-caret');
                        if (caret && (e.target === caret || caret.contains(e.target))) {
                            const model = layerEl.__gjsModel;
                            if (model && model.get('components').length) {
                                const isOpen = model.get('open');
                                model.set('open', !isOpen);
                                
                                // Toggle expanded class on the layer
                                layerEl.classList.toggle('expanded', !isOpen);
                                
                                // Toggle children visibility
                                const childrenContainer = layerEl.querySelector('.gjs-layer-children');
                                if (childrenContainer) {
                                    childrenContainer.style.display = !isOpen ? 'block' : 'none';
                                }
                            }
                        }
                    }
                });
            });

            // Handle component navigation
            editor.on('component:selected', (component: any) => {
                if (!component) return;
                
                const path = [];
                let current = component;
                
                while (current) {
                    path.unshift({
                        name: current.get('name') || current.get('type'),
                        component: current
                    });
                    current = current.parent();
                }
                
            });

            // Make all components resizable and droppable by default
            editor.on('component:create', (component: any) => {
                if (!component.get('resizable')) {
                    component.set({
                        draggable: true,
                        droppable: true,
                        resizable: {
                            tl: true,
                            tr: true,
                            bl: true,
                            br: true,
                            tc: true,
                            bc: true,
                            cl: true,
                            cr: true
                        }
                    });
                }
            });

            // Modify text component to allow children
            editor.DomComponents.addType('text', {
                model: {
                    defaults: {
                        droppable: true,
                        draggable: true,
                        resizable: {
                            tl: true,
                            tr: true,
                            bl: true,
                            br: true,
                            tc: true,
                            bc: true,
                            cl: true,
                            cr: true
                        },
                        style: {
                            position: 'relative',
                            padding: '10px',
                            minHeight: '50px',
                            minWidth: '50px',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            overflowWrap: 'break-word',
                            width: '100%',
                            boxSizing: 'border-box',
                            display: 'block'
                        }
                    }
                }
            });

            // Make container component resizable and droppable
            editor.DomComponents.addType('container', {
                model: {
                    defaults: {
                        droppable: true,
                        draggable: true,
                        resizable: {
                            tl: true,
                            tr: true,
                            bl: true,
                            br: true,
                            tc: true,
                            bc: true,
                            cl: true,
                            cr: true
                        },
                        style: {
                            position: 'relative',
                            padding: '20px',
                            minHeight: '100px',
                            backgroundColor: '#f7f7f7'
                        }
                    }
                }
            });

            // Store the editor reference
            editorRef.current = editor;
        }
    }, []);
    // UPDATED: Create nested editor when nestedEditorVisible is true
    useEffect(() => {
        if (nestedEditorVisible && nestedFrameComponent && nestedEditorContainerRef.current) {
            // Extract frame's children
            const initialComponents = nestedFrameComponent.get('components');
            // Initialize nested editor with similar configuration to main editor
            const nestedEditor = grapesjs.init({
                container: nestedEditorContainerRef.current,
                height: "100%",
                width: "100%",
                fromElement: false,
                components: JSON.stringify(initialComponents),
                storageManager: { autoload: false },
                blockManager: { blocks: [] },
                panels: { defaults: [] }
            });
            // UPDATED: Register our custom frame component for nested editor as well.
            registerFrameComponent(nestedEditor);
            nestedEditorRef.current = nestedEditor;
        }
    }, [nestedEditorVisible, nestedFrameComponent]);

    // UPDATED: Handler for saving nested editor changes
    const handleNestedEditorSave = () => {
        if (nestedEditorRef.current && nestedFrameComponent) {
            const updatedComponents = nestedEditorRef.current.getComponents();
            nestedFrameComponent.components().reset(updatedComponents);
            nestedEditorRef.current.destroy();
            nestedEditorRef.current = null;
            setNestedEditorVisible(false);
        }
    };

    // UPDATED: Handler to cancel nested editor (discard changes)
    const handleNestedEditorCancel = () => {
        if (nestedEditorRef.current) {
            nestedEditorRef.current.destroy();
            nestedEditorRef.current = null;
        }
        setNestedEditorVisible(false);
    };
    // Convert components to XML format
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
    // Add drag and drop handlers
    const handleDragStart = (e: React.DragEvent, node: TreeNode) => {
        e.dataTransfer.setData('text/plain', node.value || '');
        e.dataTransfer.effectAllowed = 'copy';
        const target = e.currentTarget as HTMLElement;
        target.classList.add('dragging');
    };

    const handleDragEnd = (e: React.DragEvent) => {
        const target = e.currentTarget as HTMLElement;
        target.classList.remove('dragging');
    };

    // Add editor event handlers
    useEffect(() => {
        if (!editorRef.current) return;

        const editor = editorRef.current;

        // Add drag and drop handlers to text components
        editor.on('component:selected', (component: any) => {
            if (component && component.get('type') === 'text') {
                const el = component.getEl();
                if (el) {
                    el.addEventListener('dragover', (e: DragEvent) => {
                        e.preventDefault();
                        e.dataTransfer!.dropEffect = 'copy';
                        el.classList.add('drop-zone');
                    });

                    el.addEventListener('dragleave', () => {
                        el.classList.remove('drop-zone');
                    });

                    el.addEventListener('drop', (e: DragEvent) => {
                        e.preventDefault();
                        el.classList.remove('drop-zone');
                        const value = e.dataTransfer!.getData('text/plain');
                        if (value) {
                            const currentContent = component.get('content') || '';
                            const newContent = currentContent + value;
                            component.set('content', newContent);
                        }
                    });
                }
            }
        });

        // Clean up event listeners when component is deselected
        editor.on('component:deselected', (component: any) => {
            if (component && component.get('type') === 'text') {
                const el = component.getEl();
                if (el) {
                    el.classList.remove('drop-zone');
                }
            }
        });

        // Handle component removal
        editor.on('component:remove', (component: any) => {
            if (component && component.get('type') === 'text') {
                const el = component.getEl();
                if (el) {
                    el.classList.remove('drop-zone');
                }
            }
        });

    }, []);

    // Update the renderTreeNode function to add drag and drop
    const renderTreeNode = (node: TreeNode, level: number = 0) => {
        const isExpanded = expandedKeys.has(node.key);
  
        return (
            <div key={node.key} className="tree-node">
                <div 
                    className="tree-node-content" 
                    style={{ paddingLeft: `${level * 20}px` }}
                    draggable={node.isLeaf && node.value !== null}
                    onDragStart={(e) => handleDragStart(e, node)}
                    onDragEnd={handleDragEnd}
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
    
    return (
        <div className="editor-container">
            {/* Top panel with improved styling */}
            <div className="panel-top">
                <div className="editor-logo">
                    <FontAwesomeIcon icon={faPencilAlt} /> Website Builder
                </div>
                <div className="panel-buttons">
                    <button className="btn-save" onClick={() => editorRef.current?.runCommand('save-page')}>
                        <FontAwesomeIcon icon={faSave} /> Save
                    </button>
                    <button className="btn-export" onClick={() => editorRef.current?.runCommand('export-xml')}>
                        <FontAwesomeIcon icon={faFileExport} /> Export XML
                    </button>
                </div>
            </div>

            <div className="editor-main">
                <div className="panel-left">
                    <div className="panel-header">
                        <FontAwesomeIcon icon={faSquare} /> Blocks
                    </div>
                    <div id="blocks" className="panel-blocks"></div>
                </div>

                <div id="gjs" className="editor-canvas"></div>

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
                        <div 
                            id="style-manager" 
                            ref={styleManagerRef} 
                            style={{ display: activeTab === 'properties' ? 'block' : 'none' }}
                            className="style-manager-container"
                        ></div>
                        <div 
                            id="layers-container" 
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
                                    <div className = "tree-view">
                                        {treeData.map(node => renderTreeNode(node))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

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
        </div>
    );
};

export default EditorGrapes;